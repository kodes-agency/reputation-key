import { describe, expect, it, vi } from 'vitest'
import { readQueueDepth, readAllQueueDepths } from './queue-depth'

describe('readQueueDepth', () => {
  it('returns null when queue is missing', async () => {
    expect(await readQueueDepth('default', null)).toBeNull()
    expect(await readQueueDepth('default', undefined)).toBeNull()
  })

  it('maps BullMQ job counts', async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 3,
        active: 1,
        delayed: 2,
        failed: 4,
        paused: 0,
      }),
    }
    await expect(readQueueDepth('default', queue)).resolves.toEqual({
      name: 'default',
      waiting: 3,
      active: 1,
      delayed: 2,
      failed: 4,
      paused: 0,
    })
    expect(queue.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'delayed',
      'failed',
      'paused',
    )
  })

  it('defaults missing count keys to 0', async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 1 }),
    }
    await expect(readQueueDepth('background', queue)).resolves.toEqual({
      name: 'background',
      waiting: 1,
      active: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
    })
  })
})

describe('readAllQueueDepths', () => {
  it('skips null queues and keeps named depths', async () => {
    const rows = await readAllQueueDepths([
      {
        name: 'default',
        queue: {
          getJobCounts: vi.fn().mockResolvedValue({ waiting: 2 }),
        },
      },
      { name: 'background', queue: null },
    ])
    expect(rows).toEqual([
      {
        name: 'default',
        waiting: 2,
        active: 0,
        delayed: 0,
        failed: 0,
        paused: 0,
      },
    ])
  })
})
