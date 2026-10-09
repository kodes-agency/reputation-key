import { describe, expect, it } from 'vitest'
import {
  describeBatchSummary,
  describeLeftOut,
  idsToPublish,
  totalsOf,
  type BatchEntry,
} from './property-look-batch-rules'

const ready = (
  mix: Partial<{ look: number; other: number; hasUnlisted: boolean }>,
  changesMayBeIncomplete = false,
): BatchEntry => ({
  kind: 'ready',
  version: 7,
  mix: { look: 0, other: 0, hasUnlisted: false, ...mix },
  changesMayBeIncomplete,
})

describe('describeLeftOut — the line of a portal that is not ticked', () => {
  it('says why a portal with other draft edits waits, and what ticking it does', () => {
    expect(describeLeftOut(ready({ look: 1, other: 2 }))).toBe(
      'Left out · also has 2 other draft edits · ticking it publishes them too',
    )
    expect(describeLeftOut(ready({ look: 1, hasUnlisted: true }))).toBe(
      'Left out · also has other draft edits · ticking it publishes them too',
    )
  })

  it('says a look-only portal the manager unticked stays as it is', () => {
    expect(describeLeftOut(ready({ look: 1 }))).toBe(
      'Left out · stays as it is for guests',
    )
  })
})

describe('totals and the summary line', () => {
  const entries: readonly BatchEntry[] = [
    ready({ look: 1 }),
    ready({ look: 1 }),
    ready({ look: 1, other: 2 }),
    { kind: 'nothing' },
    { kind: 'blocked', reasons: ['No public address'] },
    { kind: 'unreadable' },
    { kind: 'not_allowed' },
  ]

  it('counts what will be published, what has nothing new, what cannot, and the rest', () => {
    expect(totalsOf(entries)).toEqual({
      ready: 3,
      withOtherEdits: 1,
      nothing: 1,
      blocked: 1,
      other: 2,
    })
  })

  it('says it all in one line', () => {
    expect(describeBatchSummary(totalsOf(entries))).toBe(
      '2 to publish · 1 with other draft edits, unticked · 1 with nothing new · 1 cannot be published · 2 not available',
    )
  })

  it('says only what there is', () => {
    const none = { ready: 0, withOtherEdits: 0, nothing: 0, blocked: 0, other: 0 }
    expect(describeBatchSummary({ ...none, ready: 1 })).toBe('1 to publish')
    expect(describeBatchSummary(none)).toBe('No live portals')
    // Every ready portal carries other edits: none starts ticked.
    expect(describeBatchSummary({ ...none, ready: 2, withOtherEdits: 2 })).toBe(
      '2 with other draft edits, unticked',
    )
  })
})

describe('idsToPublish — what is ticked', () => {
  const rows = [
    {
      portalId: 'a',
      entry: ready({ look: 1 }),
    },
    {
      portalId: 'b',
      entry: ready({ look: 1 }),
    },
    { portalId: 'c', entry: { kind: 'blocked', reasons: [] } },
  ] as const satisfies ReadonlyArray<Readonly<{ portalId: string; entry: BatchEntry }>>

  it('takes every ready portal that was not left out, in the order shown', () => {
    expect(idsToPublish(rows, new Set(['b']))).toEqual(['a'])
    expect(idsToPublish(rows, new Set())).toEqual(['a', 'b'])
  })
})
