// Queue Redis may lose accepted jobs. The durable dispatch reservation must
// enqueue a fresh queue identity for the same work and isolate failed enqueues.

import { describe, expect, it, vi } from 'vitest'
import { reconcileWorkItems } from '#/shared/jobs/work-items.server'

const KIND = 'outbox-delivery'

describe('durable dispatch recovery', () => {
  it('recovers 10,000 lost jobs in one pass with bounded transport concurrency', async () => {
    const pending = Array.from({ length: 10_000 }, (_, index) => ({
      id: `work-${index}`,
      kind: KIND,
      dispatchSequence: 2,
    }))
    const reserveDispatch = vi.fn(async () => pending.splice(0, 100))
    let active = 0
    let peak = 0
    const enqueue = vi.fn(async (_kind: string, _data: unknown, _jobId: string) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
    })

    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 10_000,
      failed: 0,
    })
    expect(pending).toHaveLength(0)
    expect(new Set(enqueue.mock.calls.map((call) => call[2])).size).toBe(10_000)
    expect(peak).toBeLessThanOrEqual(10)
  })

  it('bounds a pass even when new due work keeps filling every batch', async () => {
    const reserveDispatch = vi.fn(async () =>
      Array.from({ length: 100 }, (_, index) => ({
        id: `work-${index}`,
        kind: KIND,
        dispatchSequence: 1,
      })),
    )
    const enqueue = vi.fn(async () => undefined)
    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 20_000,
      failed: 0,
    })
    expect(reserveDispatch).toHaveBeenCalledTimes(200)
  })

  it('keeps the reservation cutoff fixed when a pass takes longer than a minute', async () => {
    const started = new Date('2026-11-06T10:00:00Z')
    let now = started
    const reserveDispatch = vi
      .fn<
        (
          cutoff: Date,
        ) => Promise<{ id: string; kind: string; dispatchSequence: number }[]>
      >()
      .mockResolvedValue([])
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, index) => ({
          id: `work-${index}`,
          kind: KIND,
          dispatchSequence: 1,
        })),
      )
    const enqueue = vi.fn(async () => {
      now = new Date(started.getTime() + 120_000)
    })
    expect(
      await reconcileWorkItems({ reserveDispatch, enqueue, clock: () => now }),
    ).toEqual({ queued: 100, failed: 0 })
    expect(reserveDispatch.mock.calls).toEqual([[started], [started]])
    expect(now.getTime() - started.getTime()).toBe(120_000)
  })

  it('continues to later batches when every enqueue in the first batch fails', async () => {
    const pending = Array.from({ length: 205 }, (_, index) => ({
      id: `work-${index}`,
      kind: KIND,
      dispatchSequence: 2,
    }))
    const reserveDispatch = vi.fn(async () => pending.splice(0, 100))
    let called = 0
    const enqueue = vi.fn(async () => {
      if (called++ < 100) throw new Error('transport unavailable')
    })
    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 105,
      failed: 100,
    })
    expect(enqueue).toHaveBeenCalledTimes(205)
  })

  it('requeues the same work after queue loss with a fresh transport identity', async () => {
    const reserveDispatch = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'work-lost', kind: KIND, dispatchSequence: 1 }])
      .mockResolvedValueOnce([{ id: 'work-lost', kind: KIND, dispatchSequence: 2 }])
    const enqueue = vi.fn(async () => undefined)

    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 1,
      failed: 0,
    })
    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 1,
      failed: 0,
    })
    expect(enqueue.mock.calls).toEqual([
      [KIND, { workId: 'work-lost' }, 'work-lost-1'],
      [KIND, { workId: 'work-lost' }, 'work-lost-2'],
    ])
  })

  it('continues after failed transport and recovers that work on its next reservation', async () => {
    const reserveDispatch = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'work-failed', kind: KIND, dispatchSequence: 1 },
        { id: 'work-healthy', kind: KIND, dispatchSequence: 1 },
      ])
      .mockResolvedValueOnce([{ id: 'work-failed', kind: KIND, dispatchSequence: 2 }])
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('transport unavailable'))
      .mockResolvedValue(undefined)

    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 1,
      failed: 1,
    })
    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 1,
      failed: 0,
    })
    expect(enqueue.mock.calls).toEqual([
      [KIND, { workId: 'work-failed' }, 'work-failed-1'],
      [KIND, { workId: 'work-healthy' }, 'work-healthy-1'],
      [KIND, { workId: 'work-failed' }, 'work-failed-2'],
    ])
  })

  it('does no queue work when durable admission has no due dispatches', async () => {
    const reserveDispatch = vi.fn(async () => [])
    const enqueue = vi.fn(async () => undefined)
    expect(await reconcileWorkItems({ reserveDispatch, enqueue })).toEqual({
      queued: 0,
      failed: 0,
    })
    expect(enqueue).not.toHaveBeenCalled()
  })
})
