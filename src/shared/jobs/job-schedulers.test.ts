import { describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { reconcileJobSchedulers } from './job-schedulers'

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
