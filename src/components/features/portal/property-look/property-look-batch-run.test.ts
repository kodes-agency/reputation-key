import { describe, expect, it, vi } from 'vitest'
import { mapWithConcurrency, mergeRun, publishInBatches } from './property-look-batch-run'

type Outcome = Readonly<{ portalId: string; outcome: 'published'; version: number }>
const published = (ids: readonly string[]): Outcome[] =>
  ids.map((portalId) => ({ portalId, outcome: 'published', version: 2 }))

describe('publishInBatches — a request holds at most one batch', () => {
  it('sends one request when the portals fit', async () => {
    const publish = vi.fn(async (ids: readonly string[]) => published(ids))
    const result = await publishInBatches(['a', 'b', 'c'], publish, 50)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(result.outcomes.map((o) => o.portalId)).toEqual(['a', 'b', 'c'])
    expect(result.error).toBeNull()
  })

  it('splits a long list, in order, and joins the outcomes', async () => {
    const publish = vi.fn(async (ids: readonly string[]) => published(ids))
    const ids = ['a', 'b', 'c', 'd', 'e']
    const result = await publishInBatches(ids, publish, 2)
    expect(publish.mock.calls.map(([batch]) => batch)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ])
    expect(result.outcomes.map((o) => o.portalId)).toEqual(ids)
    expect(result.error).toBeNull()
  })

  it('stops at the first request that is refused and keeps what was done before it', async () => {
    const refusal = new Error('refused')
    const publish = vi
      .fn<(ids: readonly string[]) => Promise<Outcome[]>>()
      .mockImplementationOnce(async (ids) => published(ids))
      .mockRejectedValueOnce(refusal)
    const result = await publishInBatches(['a', 'b', 'c', 'd', 'e'], publish, 2)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(result.outcomes.map((o) => o.portalId)).toEqual(['a', 'b'])
    expect(result.error).toBe(refusal)
  })

  it('names the request that failed apart from the ones never sent', async () => {
    // The request threw, so nothing says whether its portals went live: the
    // server publishes them one by one and may have got through some.
    const publish = vi
      .fn<(ids: readonly string[]) => Promise<Outcome[]>>()
      .mockImplementationOnce(async (ids) => published(ids))
      .mockRejectedValueOnce(new Error('timeout'))
    const result = await publishInBatches(['a', 'b', 'c', 'd', 'e'], publish, 2)
    expect(result.unconfirmed).toEqual(['c', 'd'])
  })

  it('has nothing unconfirmed when every request was answered', async () => {
    const publish = vi.fn(async (ids: readonly string[]) => published(ids))
    expect((await publishInBatches(['a', 'b'], publish, 2)).unconfirmed).toEqual([])
  })

  it('sends nothing for no portals', async () => {
    const publish = vi.fn(async (ids: readonly string[]) => published(ids))
    const result = await publishInBatches([], publish, 50)
    expect(publish).not.toHaveBeenCalled()
    expect(result).toEqual({ outcomes: [], unconfirmed: [], error: null })
  })
})

describe('mapWithConcurrency', () => {
  it('keeps the order of the input whatever order the answers arrive in', async () => {
    const result = await mapWithConcurrency([30, 5, 15], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return ms * 2
    })
    expect(result).toEqual([60, 10, 30])
  })

  it('never runs more at once than the limit', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 2))
      running -= 1
    })
    expect(peak).toBe(3)
  })

  it('answers an empty list with an empty list', async () => {
    expect(await mapWithConcurrency([], 3, async (x: number) => x)).toEqual([])
  })
})

describe('mergeRun — what a retry adds to the run before it', () => {
  const order = ['a', 'b', 'c', 'd']
  const failed = (portalId: string) => ({ portalId, outcome: 'failed' }) as never
  const before = {
    attempted: ['a', 'b', 'c'],
    outcomes: [published(['a'])[0], failed('b')] as never[],
  }

  it('replaces the retried portal’s earlier outcome, once, and keeps the others', () => {
    const merged = mergeRun(
      before,
      ['b', 'c'],
      {
        outcomes: published(['b', 'c']),
        unconfirmed: [],
        error: null,
      },
      order,
    )
    expect(merged.outcomes.map((o) => `${o.portalId}:${o.outcome}`)).toEqual([
      'a:published',
      'b:published',
      'c:published',
    ])
    expect(merged.unconfirmed).toEqual([])
    expect(merged.error).toBeNull()
  })

  it('lists the portals asked in the order shown, the retried ones among them', () => {
    const merged = mergeRun(
      { attempted: ['c', 'a'], outcomes: [] },
      ['d'],
      { outcomes: [], unconfirmed: ['d'], error: new Error('x') },
      order,
    )
    expect(merged.attempted).toEqual(['a', 'c', 'd'])
    expect(merged.unconfirmed).toEqual(['d'])
  })

  it('does not carry an earlier run’s doubt over to a portal that was answered since', () => {
    const merged = mergeRun(
      { attempted: ['a'], outcomes: [] },
      ['a'],
      { outcomes: published(['a']), unconfirmed: [], error: null },
      order,
    )
    expect(merged.unconfirmed).toEqual([])
  })
})
