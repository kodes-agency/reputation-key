import { describe, expect, it } from 'vitest'
import {
  attentionLine,
  attentionRank,
  needsAttention,
  portalAttention,
  offersAttentionFilter,
} from './portal-attention'
import { NO_CODE, OLDER_CODE, overviewRow } from './portal-overview-fixtures'

const attentionOf = (overrides: Parameters<typeof overviewRow>[1]) =>
  portalAttention(overviewRow('p', overrides))

describe('portalAttention', () => {
  it('says nothing about a live Portal that needs nothing', () => {
    const attention = attentionOf({})
    expect(attention).toEqual({ kind: 'none' })
    expect(attentionLine(attention)).toBeNull()
    expect(needsAttention(attention)).toBe(false)
  })

  it('names the state of a Portal that is not live, not a list of problems', () => {
    expect(attentionOf({ publicationState: 'draft', token: NO_CODE })).toEqual({
      kind: 'draft',
    })
    expect(attentionOf({ publicationState: 'disabled' })).toEqual({ kind: 'disabled' })
    expect(attentionOf({ publicationState: 'archived' })).toEqual({ kind: 'archived' })
  })

  it('does not call a draft without a manager or a code broken', () => {
    expect(
      attentionOf({
        publicationState: 'draft',
        token: NO_CODE,
        responsibleManagerUserIds: [],
        health: { status: 'unavailable', reason: 'publication_draft' },
      }).kind,
    ).toBe('draft')
  })

  it('counts changes that are not live', () => {
    const attention = attentionOf({ pendingChangeCount: 2 })
    expect(attention).toEqual({ kind: 'pending', count: 2 })
    expect(attentionLine(attention)).toBe('2 changes not live')
    expect(attentionLine({ kind: 'pending', count: 1 })).toBe('1 change not live')
  })

  it('reports nobody being responsible for a live Portal', () => {
    const attention = attentionOf({ responsibleManagerUserIds: [] })
    expect(attention.kind).toBe('issues')
    if (attention.kind !== 'issues') return
    expect(attention.issues.map((issue) => issue.code)).toEqual(['no_responsible'])
    expect(attentionLine(attention)).toBe('1 issue')
  })

  it('reports a live Portal no guest can reach', () => {
    const attention = attentionOf({ token: NO_CODE })
    if (attention.kind !== 'issues') throw new Error('expected issues')
    expect(attention.issues.map((issue) => issue.code)).toEqual(['no_code'])
  })

  it('flags a live Portal whose code predates access artifacts, as its own line', () => {
    const attention = attentionOf({ token: OLDER_CODE })
    expect(attention).toEqual({ kind: 'older_code' })
    expect(attentionLine(attention)).toBe('Older code · scans not counted')
    expect(needsAttention(attention)).toBe(true)
  })

  it('does not call an older code an issue: it still works, so it is not counted in "N issues"', () => {
    const attention = attentionOf({ token: OLDER_CODE, responsibleManagerUserIds: [] })
    if (attention.kind !== 'issues') throw new Error('expected issues')
    expect(attention.issues.map((issue) => issue.code)).toEqual(['no_responsible'])
  })

  it('puts an older code before changes that are not live, so it is not hidden', () => {
    expect(attentionOf({ token: OLDER_CODE, pendingChangeCount: 2 })).toEqual({
      kind: 'older_code',
    })
  })

  it('says nothing about an older code on a Portal that is not live', () => {
    expect(attentionOf({ token: OLDER_CODE, publicationState: 'draft' })).toEqual({
      kind: 'draft',
    })
    expect(attentionOf({ token: OLDER_CODE, publicationState: 'disabled' })).toEqual({
      kind: 'disabled',
    })
    expect(attentionOf({ token: OLDER_CODE, publicationState: 'archived' })).toEqual({
      kind: 'archived',
    })
  })

  it('says nothing about a Portal with no code: that is the "No working code" issue', () => {
    const attention = attentionOf({ token: NO_CODE })
    if (attention.kind !== 'issues') throw new Error('expected issues')
    expect(attention.issues.map((issue) => issue.code)).toEqual(['no_code'])
  })

  it('reads what Health knows and the row cannot: property, version, Google', () => {
    const code = (reason: Parameters<typeof overviewRow>[1]) => {
      const attention = attentionOf(reason)
      if (attention.kind !== 'issues') throw new Error('expected issues')
      return attention.issues.map((issue) => issue.code)
    }
    expect(
      code({ health: { status: 'unavailable', reason: 'property_unavailable' } }),
    ).toEqual(['property_unavailable'])
    expect(
      code({
        health: { status: 'unavailable', reason: 'publication_snapshot_unavailable' },
      }),
    ).toEqual(['no_live_version'])
    expect(
      code({
        health: { status: 'degraded', reason: 'google_destination_awaiting_refresh' },
      }),
    ).toEqual(['google_refreshing'])
    expect(
      code({
        health: { status: 'degraded', reason: 'google_destination_unavailable' },
      }),
    ).toEqual(['google_unavailable'])
  })

  it('counts each problem once, however many sources report it', () => {
    const attention = attentionOf({
      token: NO_CODE,
      responsibleManagerUserIds: [],
      health: { status: 'unavailable', reason: 'public_address_unavailable' },
    })
    if (attention.kind !== 'issues') throw new Error('expected issues')
    expect(attention.issues.map((issue) => issue.code)).toEqual([
      'no_code',
      'no_responsible',
    ])
    expect(attentionLine(attention)).toBe('2 issues')
  })

  it('has no Health yet: issues come from the row alone', () => {
    expect(attentionOf({ health: null })).toEqual({ kind: 'none' })
  })

  it('puts issues before changes that are not live', () => {
    const attention = attentionOf({
      responsibleManagerUserIds: [],
      pendingChangeCount: 3,
    })
    expect(attention.kind).toBe('issues')
  })

  it('gives every issue words and a place to fix it', () => {
    const attention = attentionOf({ token: NO_CODE, responsibleManagerUserIds: [] })
    if (attention.kind !== 'issues') throw new Error('expected issues')
    for (const issue of attention.issues) {
      expect(issue.title.length).toBeGreaterThan(0)
      expect(issue.detail.length).toBeGreaterThan(0)
    }
    expect(attention.issues.map((issue) => issue.fix)).toEqual(['share', 'responsible'])
  })
})

describe('attentionLine', () => {
  it('words each state in one short phrase', () => {
    expect(attentionLine({ kind: 'draft' })).toBe('Draft · not published')
    expect(attentionLine({ kind: 'disabled' })).toBe('Disabled · guests cannot open it')
    expect(attentionLine({ kind: 'archived' })).toBe('Archived')
    expect(attentionLine({ kind: 'none' })).toBeNull()
  })
})

describe('ordering by attention', () => {
  it('ranks issues, then an older code, then changes, then setup, then disabled, then quiet, then archived', () => {
    const ranks = (
      [
        { kind: 'archived' },
        { kind: 'none' },
        { kind: 'disabled' },
        { kind: 'draft' },
        { kind: 'pending', count: 1 },
        { kind: 'older_code' },
        { kind: 'issues', issues: [] },
      ] as const
    ).map(attentionRank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(ranks.length)
  })

  it('counts every state except live-and-quiet and archived as needing attention', () => {
    expect(needsAttention({ kind: 'draft' })).toBe(true)
    expect(needsAttention({ kind: 'disabled' })).toBe(true)
    expect(needsAttention({ kind: 'pending', count: 1 })).toBe(true)
    expect(needsAttention({ kind: 'older_code' })).toBe(true)
    expect(needsAttention({ kind: 'archived' })).toBe(false)
    expect(needsAttention({ kind: 'none' })).toBe(false)
  })
})

describe('offersAttentionFilter', () => {
  it('offers the filter while a Portal needs attention', () => {
    expect(offersAttentionFilter(2, {})).toBe(true)
  })

  it('leaves it out when nothing needs attention, as it would keep nothing', () => {
    expect(offersAttentionFilter(0, {})).toBe(false)
  })

  it('keeps it while it is on, so it can be turned off', () => {
    expect(offersAttentionFilter(0, { show: 'attention' })).toBe(true)
  })
})
