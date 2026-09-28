// Boot reconciliation upserts only what changed. Re-upserting an unchanged
// cron scheduler cancels its waiting iteration in BullMQ 6 (the real-Redis
// proof is in job-schedulers.integration.test.ts); a changed one must still
// be applied.

import { describe, expect, it, vi } from 'vitest'
import type { JobSchedulerJson, Queue } from 'bullmq'
import { reconcileJobSchedulers, type JobSchedulerRegistration } from './job-schedulers'

const DIGEST: JobSchedulerRegistration = {
  schedulerId: 'digest-notification-recurring',
  jobName: 'digest-notification',
  repeat: { pattern: '0 * * * *' },
  jobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
}

// What BullMQ 6 reads back for DIGEST: an offset of its own, keys reordered,
// and no template data for an empty payload.
const INSTALLED: JobSchedulerJson = {
  key: 'digest-notification-recurring',
  name: 'digest-notification',
  next: 1_790_614_800_000,
  iterationCount: 1,
  pattern: '0 * * * *',
  offset: 0,
  template: { opts: { backoff: { delay: 1_000, type: 'exponential' }, attempts: 3 } },
}

const reconcile = async (desired: JobSchedulerRegistration) => {
  const queue = {
    name: 'background',
    getJobSchedulers: vi.fn(async () => [INSTALLED]),
    removeJobScheduler: vi.fn(async () => true),
    upsertJobScheduler: vi.fn(async () => ({ id: 'next-job' })),
  }
  const result = await reconcileJobSchedulers({
    queue: queue as unknown as Queue,
    managedJobNames: ['digest-notification'],
    desired: [desired],
    planRecord: null,
  })
  return { queue, result }
}

describe('boot reconciliation of an installed scheduler', () => {
  it('leaves a cron scheduler that is installed exactly as desired alone', async () => {
    const { queue, result } = await reconcile(DIGEST)

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
    expect(result.upsertedSchedulerIds).toEqual([])
  })

  it('applies a changed cadence', async () => {
    const { queue } = await reconcile({ ...DIGEST, repeat: { pattern: '30 * * * *' } })

    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce()
  })

  it('applies changed job options', async () => {
    const { queue } = await reconcile({ ...DIGEST, jobOptions: { attempts: 5 } })

    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce()
  })

  it('applies a repeat option it cannot compare', async () => {
    const { queue } = await reconcile({
      ...DIGEST,
      repeat: { pattern: '0 * * * *', immediately: true },
    })

    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce()
  })
})
