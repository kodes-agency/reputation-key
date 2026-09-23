import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import pino from 'pino'
import {
  JOB_SCHEDULER_WATCHDOG_INTERVAL_MS,
  jobSchedulerPlanFingerprint,
  reconcileJobSchedulers,
  restoreMissingJobSchedulers,
  startJobSchedulerWatchdog,
  type JobSchedulerRegistration,
} from './job-schedulers'

function queueDouble(existing: ReadonlyArray<Readonly<{ key: string; name: string }>>) {
  return {
    name: 'background',
    getJobSchedulers: vi.fn(async () => existing),
    removeJobScheduler: vi.fn(async () => true),
    upsertJobScheduler: vi.fn(async () => ({ id: 'next-job' })),
  }
}

/** The Queue Redis record of which plan owns the queue's schedulers. */
function planRecordDouble(owner: string | null = null) {
  let recorded = owner
  return {
    read: vi.fn(async (_queueName: string) => recorded),
    record: vi.fn(async (_queueName: string, fingerprint: string) => {
      recorded = fingerprint
    }),
    claim: vi.fn(async (_queueName: string, fingerprint: string) => {
      if (recorded !== null) return false
      recorded = fingerprint
      return true
    }),
  }
}

describe('job scheduler reconciliation', () => {
  it('removes legacy and disabled managed schedules before stable upsert', async () => {
    const queue = queueDouble([
      { key: 'legacy-cadence-hash', name: 'health-check' },
      { key: 'digest-recurring', name: 'digest-notification' },
      { key: 'operator-owned', name: 'operator-maintenance' },
    ])

    const result = await reconcileJobSchedulers({
      queue: queue as unknown as Queue,
      managedJobNames: ['health-check', 'digest-notification'],
      desired: [
        {
          schedulerId: 'health-check-recurring',
          jobName: 'health-check',
          repeat: { every: 300_000 },
          jobOptions: { attempts: 3 },
        },
      ],
      planRecord: null,
    })

    expect(queue.removeJobScheduler.mock.calls).toEqual([
      ['legacy-cadence-hash'],
      ['digest-recurring'],
    ])
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'health-check-recurring',
      { every: 300_000 },
      {
        name: 'health-check',
        data: {},
        opts: { attempts: 3 },
      },
    )
    expect(result).toEqual({
      removedSchedulerIds: ['legacy-cadence-hash', 'digest-recurring'],
      upsertedSchedulerIds: ['health-check-recurring'],
    })
  })

  it('updates the cadence under the existing stable scheduler ID', async () => {
    const queue = queueDouble([{ key: 'health-check-recurring', name: 'health-check' }])

    await reconcileJobSchedulers({
      queue: queue as unknown as Queue,
      managedJobNames: ['health-check'],
      desired: [
        {
          schedulerId: 'health-check-recurring',
          jobName: 'health-check',
          repeat: { every: 600_000 },
          jobOptions: {},
        },
      ],
      planRecord: null,
    })

    expect(queue.removeJobScheduler).not.toHaveBeenCalled()
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'health-check-recurring',
      { every: 600_000 },
      expect.objectContaining({ name: 'health-check' }),
    )
  })

  it.each([
    {
      label: 'duplicate scheduler IDs',
      desired: [
        { schedulerId: 'same', jobName: 'one', repeat: { every: 1 }, jobOptions: {} },
        { schedulerId: 'same', jobName: 'two', repeat: { every: 2 }, jobOptions: {} },
      ],
    },
    {
      label: 'two schedulers for one managed job',
      desired: [
        { schedulerId: 'one', jobName: 'same', repeat: { every: 1 }, jobOptions: {} },
        { schedulerId: 'two', jobName: 'same', repeat: { every: 2 }, jobOptions: {} },
      ],
    },
  ])('rejects $label before reading Redis', async ({ desired }) => {
    const queue = queueDouble([])

    await expect(
      reconcileJobSchedulers({
        queue: queue as unknown as Queue,
        managedJobNames: desired.map((schedule) => schedule.jobName),
        desired,
        planRecord: null,
      }),
    ).rejects.toThrow('Duplicate')
    expect(queue.getJobSchedulers).not.toHaveBeenCalled()
  })
})

const HEALTH_CHECK: JobSchedulerRegistration = {
  schedulerId: 'health-check-recurring',
  jobName: 'health-check',
  repeat: { every: 300_000 },
  jobOptions: { attempts: 3 },
}
const DIGEST: JobSchedulerRegistration = {
  schedulerId: 'digest-notification-recurring',
  jobName: 'digest-notification',
  repeat: { pattern: '0 * * * *' },
  jobOptions: { attempts: 3 },
}

// A release's boot reconciliation owns the queue's scheduler set: it records
// its plan in Queue Redis. During a deploy overlap the outgoing worker is still
// running; its watchdog must not put back a scheduler the new plan removed.
describe('scheduler plan ownership', () => {
  it('records the reconciled plan as the owner of the queue schedulers', async () => {
    const queue = queueDouble([])
    const planRecord = planRecordDouble()

    await reconcileJobSchedulers({
      queue: queue as unknown as Queue,
      managedJobNames: ['health-check', 'digest-notification'],
      desired: [HEALTH_CHECK, DIGEST],
      planRecord,
    })

    expect(planRecord.record).toHaveBeenCalledWith(
      'background',
      jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST]),
    )
    // Content-free and order-free: a digest of ids, names and cadences.
    expect(jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST])).toMatch(/^[a-f0-9]{64}$/)
    expect(jobSchedulerPlanFingerprint([DIGEST, HEALTH_CHECK])).toBe(
      jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST]),
    )
    expect(jobSchedulerPlanFingerprint([HEALTH_CHECK])).not.toBe(
      jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST]),
    )
  })

  it('restores nothing once a newer boot reconciled a different plan', async () => {
    const renamed = { ...DIGEST, schedulerId: 'digest-notification-hourly' }
    const queue = queueDouble([{ key: 'health-check-recurring', name: 'health-check' }])

    const result = await restoreMissingJobSchedulers({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
      planRecord: planRecordDouble(jobSchedulerPlanFingerprint([HEALTH_CHECK, renamed])),
    })

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(result).toEqual({ restoredSchedulerIds: [], superseded: true })
  })

  it('claims the plan again after Redis lost it, then restores', async () => {
    const queue = queueDouble([])
    const planRecord = planRecordDouble(null)

    const result = await restoreMissingJobSchedulers({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
      planRecord,
    })

    expect(planRecord.claim).toHaveBeenCalledWith(
      'background',
      jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST]),
    )
    expect(result).toEqual({
      restoredSchedulerIds: ['health-check-recurring', 'digest-notification-recurring'],
      superseded: false,
    })
  })

  it('stands down when another plan claims the lost record first', async () => {
    const planRecord = planRecordDouble(null)
    // The other process's claim lands between this one's read and its claim.
    planRecord.claim.mockResolvedValueOnce(false)
    planRecord.read
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(jobSchedulerPlanFingerprint([HEALTH_CHECK]))
    const queue = queueDouble([])

    const result = await restoreMissingJobSchedulers({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
      planRecord,
    })

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(result).toEqual({ restoredSchedulerIds: [], superseded: true })
  })
})

// Schedulers live only in Queue Redis (ADR 0053: no persistence required).
// After a Redis restart the worker keeps running with none of them unless
// something puts them back.
describe('restoring schedulers lost from Queue Redis', () => {
  it('re-installs only the missing schedulers and never touches a present one', async () => {
    const queue = queueDouble([
      { key: 'digest-notification-recurring', name: 'digest-notification' },
    ])

    const result = await restoreMissingJobSchedulers({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
      planRecord: planRecordDouble(jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST])),
    })

    // Re-upserting a present cron scheduler would drop its pending overdue
    // run (BullMQ 6) and skip that hour's digest, so it is left alone.
    expect(queue.upsertJobScheduler.mock.calls).toEqual([
      [
        'health-check-recurring',
        { every: 300_000 },
        { name: 'health-check', data: {}, opts: { attempts: 3 } },
      ],
    ])
    expect(queue.removeJobScheduler).not.toHaveBeenCalled()
    expect(result).toEqual({
      restoredSchedulerIds: ['health-check-recurring'],
      superseded: false,
    })
  })

  it('does nothing while every desired scheduler is present', async () => {
    const queue = queueDouble([
      { key: 'health-check-recurring', name: 'health-check' },
      { key: 'digest-notification-recurring', name: 'digest-notification' },
    ])

    const result = await restoreMissingJobSchedulers({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
      planRecord: planRecordDouble(jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST])),
    })

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(result).toEqual({ restoredSchedulerIds: [], superseded: false })
  })
})

describe('job scheduler watchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function watch(
    queue: ReturnType<typeof queueDouble>,
    planRecord = planRecordDouble(jobSchedulerPlanFingerprint([HEALTH_CHECK, DIGEST])),
  ) {
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    const onRestored = vi.fn(async () => {})
    const stop = startJobSchedulerWatchdog({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
      planRecord,
      intervalMs: JOB_SCHEDULER_WATCHDOG_INTERVAL_MS,
      logger,
      onRestored,
    })
    return { stop, warn, onRestored }
  }

  it('restores lost schedulers on its interval and reports the restore', async () => {
    vi.useFakeTimers()
    const queue = queueDouble([])
    const { stop, warn, onRestored } = watch(queue)

    await vi.advanceTimersByTimeAsync(JOB_SCHEDULER_WATCHDOG_INTERVAL_MS)
    stop()

    expect(queue.upsertJobScheduler.mock.calls).toEqual([
      ['health-check-recurring', HEALTH_CHECK.repeat, expect.anything()],
      ['digest-notification-recurring', DIGEST.repeat, expect.anything()],
    ])
    expect(onRestored).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      {
        restoredSchedulerIds: ['health-check-recurring', 'digest-notification-recurring'],
      },
      expect.stringMatching(/restored/i),
    )
  })

  it('stays quiet while nothing is missing, and stops when told to', async () => {
    vi.useFakeTimers()
    const queue = queueDouble([
      { key: 'health-check-recurring', name: 'health-check' },
      { key: 'digest-notification-recurring', name: 'digest-notification' },
    ])
    const { stop, onRestored } = watch(queue)

    await vi.advanceTimersByTimeAsync(JOB_SCHEDULER_WATCHDOG_INTERVAL_MS)
    expect(queue.getJobSchedulers).toHaveBeenCalledOnce()
    stop()
    await vi.advanceTimersByTimeAsync(3 * JOB_SCHEDULER_WATCHDOG_INTERVAL_MS)

    expect(queue.getJobSchedulers).toHaveBeenCalledOnce()
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('says once that a newer plan owns the schedulers, and restores nothing', async () => {
    vi.useFakeTimers()
    const queue = queueDouble([])
    const { stop, warn, onRestored } = watch(
      queue,
      planRecordDouble(jobSchedulerPlanFingerprint([HEALTH_CHECK])),
    )

    await vi.advanceTimersByTimeAsync(3 * JOB_SCHEDULER_WATCHDOG_INTERVAL_MS)
    stop()

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(onRestored).not.toHaveBeenCalled()
    expect(
      warn.mock.calls.filter(([, message]) => /superseded/i.test(String(message))),
    ).toHaveLength(1)
  })

  it('logs a failed check and keeps watching — Redis may be back next time', async () => {
    vi.useFakeTimers()
    const queue = queueDouble([])
    queue.getJobSchedulers.mockRejectedValueOnce(new Error('connection is closed'))
    const { stop, warn } = watch(queue)

    await vi.advanceTimersByTimeAsync(JOB_SCHEDULER_WATCHDOG_INTERVAL_MS)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringMatching(/watchdog/i),
    )

    await vi.advanceTimersByTimeAsync(JOB_SCHEDULER_WATCHDOG_INTERVAL_MS)
    stop()
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2)
  })
})
