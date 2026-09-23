import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import {
  JOB_SCHEDULER_PLAN_KEY_PREFIX,
  createRedisSchedulerPlanRecord,
  jobSchedulerPlanFingerprint,
  reconcileJobSchedulers,
  restoreMissingJobSchedulers,
  type JobSchedulerRegistration,
  type SchedulerPlanRecord,
} from './job-schedulers'

describe.sequential('job scheduler reconciliation (real Redis)', () => {
  let connection: Redis
  let queue: Queue
  let planRecord: SchedulerPlanRecord

  beforeEach(() => {
    connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
    queue = new Queue(`scheduler-reconcile-${randomUUID()}`, {
      connection: connection as unknown as import('bullmq').ConnectionOptions,
    })
    planRecord = createRedisSchedulerPlanRecord(connection)
  })

  afterEach(async () => {
    for (const scheduler of await queue.getJobSchedulers(0, -1, true)) {
      await queue.removeJobScheduler(scheduler.key)
    }
    await connection.del(`${JOB_SCHEDULER_PLAN_KEY_PREFIX}${queue.name}`)
    await queue.obliterate({ force: true })
    await queue.close()
    await connection.quit()
  })

  it('replaces off-key managed schedulers without duplicating cadence or unrelated work', async () => {
    // A managed family installed under a key that is not its stable ID (an
    // older release's naming) must be replaced, not duplicated.
    await queue.upsertJobScheduler(
      'health-check-old-key',
      { every: 300_000 },
      { name: 'health-check' },
    )
    await queue.upsertJobScheduler(
      'digest-recurring',
      { every: 3_600_000 },
      { name: 'digest-notification' },
    )
    await queue.upsertJobScheduler(
      'operator-owned',
      { every: 86_400_000 },
      { name: 'operator-maintenance' },
    )

    const offKey = (await queue.getJobSchedulers()).find(
      (scheduler) => scheduler.name === 'health-check',
    )
    expect(offKey?.key).toBe('health-check-old-key')

    await reconcileJobSchedulers({
      queue,
      managedJobNames: ['health-check', 'digest-notification'],
      desired: [
        {
          schedulerId: 'health-check-recurring',
          jobName: 'health-check',
          repeat: { every: 600_000 },
          jobOptions: { attempts: 3 },
        },
      ],
      planRecord,
    })

    const current = await queue.getJobSchedulers(0, -1, true)
    expect(
      current
        .map(({ key, name, every }) => ({ key, name, every }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ).toEqual([
      {
        key: 'health-check-recurring',
        name: 'health-check',
        every: 600_000,
      },
      {
        key: 'operator-owned',
        name: 'operator-maintenance',
        every: 86_400_000,
      },
    ])
  })

  it('restores schedulers lost with Redis state and leaves the surviving ones alone', async () => {
    const desired: JobSchedulerRegistration[] = [
      {
        schedulerId: 'health-check-recurring',
        jobName: 'health-check',
        repeat: { every: 300_000 },
        jobOptions: { attempts: 3 },
      },
      {
        schedulerId: 'digest-notification-recurring',
        jobName: 'digest-notification',
        repeat: { pattern: '0 * * * *' },
        jobOptions: { attempts: 3 },
      },
    ]
    await reconcileJobSchedulers({
      queue,
      managedJobNames: ['health-check', 'digest-notification'],
      desired,
      planRecord,
    })
    const digestBefore = await queue.getJobScheduler('digest-notification-recurring')

    // One scheduler's keys vanish; the other survives with its next run.
    await queue.removeJobScheduler('health-check-recurring')
    // Re-upserting an unchanged cron scheduler recomputes the same next run,
    // so only the upserts themselves tell a restore from a blanket reconcile —
    // the one that drops an overdue pending iteration in BullMQ 6.
    const upsert = vi.spyOn(queue, 'upsertJobScheduler')
    const partial = await restoreMissingJobSchedulers({ queue, desired, planRecord })

    expect(partial.restoredSchedulerIds).toEqual(['health-check-recurring'])
    expect(upsert.mock.calls.map(([schedulerId]) => schedulerId)).toEqual([
      'health-check-recurring',
    ])
    expect((await queue.getJobScheduler('digest-notification-recurring'))?.next).toBe(
      digestBefore?.next,
    )
    upsert.mockRestore()

    // Everything this queue held in Redis is gone, the plan record with it.
    await queue.obliterate({ force: true })
    await connection.del(`${JOB_SCHEDULER_PLAN_KEY_PREFIX}${queue.name}`)
    const total = await restoreMissingJobSchedulers({ queue, desired, planRecord })

    expect(total.restoredSchedulerIds).toEqual([
      'health-check-recurring',
      'digest-notification-recurring',
    ])
    // The restore claimed the lost plan record back for its plan.
    expect(await planRecord.read(queue.name)).toBe(jobSchedulerPlanFingerprint(desired))
    expect(
      (await queue.getJobSchedulers(0, -1, true))
        .map(({ key, name }) => ({ key, name }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ).toEqual([
      { key: 'digest-notification-recurring', name: 'digest-notification' },
      { key: 'health-check-recurring', name: 'health-check' },
    ])
  })

  it('does not let an outgoing worker restore a scheduler its successor removed', async () => {
    const healthCheck: JobSchedulerRegistration = {
      schedulerId: 'health-check-recurring',
      jobName: 'health-check',
      repeat: { every: 300_000 },
      jobOptions: { attempts: 3 },
    }
    const digest = (schedulerId: string): JobSchedulerRegistration => ({
      schedulerId,
      jobName: 'digest-notification',
      repeat: { pattern: '0 * * * *' },
      jobOptions: { attempts: 3 },
    })
    const outgoing = [healthCheck, digest('digest-notification-recurring')]
    const incoming = [healthCheck, digest('digest-notification-hourly')]
    const managedJobNames = ['health-check', 'digest-notification']
    await reconcileJobSchedulers({
      queue,
      managedJobNames,
      desired: outgoing,
      planRecord,
    })

    // The new release boots during the overlap and renames the digest's id.
    await reconcileJobSchedulers({
      queue,
      managedJobNames,
      desired: incoming,
      planRecord,
    })
    const restore = await restoreMissingJobSchedulers({
      queue,
      desired: outgoing,
      planRecord,
    })

    expect(restore).toEqual({ restoredSchedulerIds: [], superseded: true })
    expect(
      (await queue.getJobSchedulers(0, -1, true)).map(({ key }) => key).sort(),
    ).toEqual(['digest-notification-hourly', 'health-check-recurring'])
  })
})
