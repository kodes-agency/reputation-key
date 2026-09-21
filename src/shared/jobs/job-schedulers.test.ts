import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import pino from 'pino'
import {
  JOB_SCHEDULER_WATCHDOG_INTERVAL_MS,
  reconcileJobSchedulers,
  restoreMissingJobSchedulers,
  startJobSchedulerWatchdog,
  type JobSchedulerRegistration,
} from './job-schedulers'

function queueDouble(existing: ReadonlyArray<Readonly<{ key: string; name: string }>>) {
  return {
    getJobSchedulers: vi.fn(async () => existing),
    removeJobScheduler: vi.fn(async () => true),
    upsertJobScheduler: vi.fn(async () => ({ id: 'next-job' })),
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
    expect(result).toEqual({ restoredSchedulerIds: ['health-check-recurring'] })
  })

  it('does nothing while every desired scheduler is present', async () => {
    const queue = queueDouble([
      { key: 'health-check-recurring', name: 'health-check' },
      { key: 'digest-notification-recurring', name: 'digest-notification' },
    ])

    const result = await restoreMissingJobSchedulers({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
    })

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(result).toEqual({ restoredSchedulerIds: [] })
  })
})

describe('job scheduler watchdog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function watch(queue: ReturnType<typeof queueDouble>) {
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    const onRestored = vi.fn(async () => {})
    const stop = startJobSchedulerWatchdog({
      queue: queue as unknown as Queue,
      desired: [HEALTH_CHECK, DIGEST],
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

    expect(queue.upsertJobScheduler.mock.calls.map((call) => call[0])).toEqual([
      'health-check-recurring',
      'digest-notification-recurring',
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
