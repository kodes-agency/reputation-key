import { describe, expect, it } from 'vitest'
import {
  attentionLine,
  attentionRank,
  countBlockedPortals,
  hasUncountedScans,
  isBlocked,
  needsAttention,
  portalAttention,
  offersAttentionFilter,
  uncountedScanPortals,
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
    // One issue is named in the row, so a reader can triage without opening it.
    expect(attentionLine(attention)).toBe('No one responsible')
  })

  it('reports a live Portal no guest can reach', () => {
    const attention = attentionOf({ token: NO_CODE })
    if (attention.kind !== 'issues') throw new Error('expected issues')
    expect(attention.issues.map((issue) => issue.code)).toEqual(['no_code'])
  })

  it('flags a live Portal whose code predates access artifacts, as its own line', () => {
    const attention = attentionOf({ token: OLDER_CODE })
    expect(attention).toEqual({ kind: 'older_code' })
    // The line says what is missing and what puts it right, and that it costs a reprint.
    expect(attentionLine(attention)).toBe(
      'Scans not counted · replace the code (needs reprinting)',
    )
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

  it('names the one issue in a few words, and counts two or more', () => {
    const one = attentionOf({ token: NO_CODE })
    expect(attentionLine(one)).toBe('No working code')
    const google = attentionOf({
      health: { status: 'degraded', reason: 'google_destination_unavailable' },
    })
    expect(attentionLine(google)).toBe('Google link unavailable')
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

describe('blocking issues', () => {
  const blocked = (overrides: Parameters<typeof overviewRow>[1]) =>
    isBlocked(attentionOf(overrides))

  it('treats no code, no live version, an unavailable property and no Google link as blocking', () => {
    expect(blocked({ token: NO_CODE })).toBe(true)
    expect(
      blocked({
        health: { status: 'unavailable', reason: 'publication_snapshot_unavailable' },
      }),
    ).toBe(true)
    expect(
      blocked({ health: { status: 'unavailable', reason: 'property_unavailable' } }),
    ).toBe(true)
    expect(
      blocked({
        health: { status: 'degraded', reason: 'google_destination_unavailable' },
      }),
    ).toBe(true)
  })

  it('does not treat a missing manager, a refreshing Google link, a draft or an older code as blocking', () => {
    expect(blocked({ responsibleManagerUserIds: [] })).toBe(false)
    expect(
      blocked({
        health: { status: 'degraded', reason: 'google_destination_awaiting_refresh' },
      }),
    ).toBe(false)
    expect(blocked({ publicationState: 'draft', token: NO_CODE })).toBe(false)
    expect(blocked({ token: OLDER_CODE })).toBe(false)
    expect(blocked({ pendingChangeCount: 2 })).toBe(false)
  })

  it('is blocking when one of several issues is', () => {
    expect(blocked({ token: NO_CODE, responsibleManagerUserIds: [] })).toBe(true)
  })

  it('counts the Portals guests cannot use, once each', () => {
    const rows = [
      overviewRow('a', { token: NO_CODE }),
      overviewRow('b', { token: NO_CODE, responsibleManagerUserIds: [] }),
      overviewRow('c', { responsibleManagerUserIds: [] }),
      overviewRow('d', { publicationState: 'draft', token: NO_CODE }),
      overviewRow('e'),
    ]
    expect(countBlockedPortals(rows)).toBe(2)
    expect(countBlockedPortals([])).toBe(0)
  })
})

describe('uncounted scans', () => {
  it('belongs to a live Portal whose code predates scan counting, and to no other', () => {
    expect(hasUncountedScans(overviewRow('a', { token: OLDER_CODE }))).toBe(true)
    expect(hasUncountedScans(overviewRow('b'))).toBe(false)
    expect(hasUncountedScans(overviewRow('c', { token: NO_CODE }))).toBe(false)
    expect(
      hasUncountedScans(
        overviewRow('d', { token: OLDER_CODE, publicationState: 'draft' }),
      ),
    ).toBe(false)
  })

  it('still holds when the Portal also has an issue, which hides the older-code line', () => {
    const row = overviewRow('a', { token: OLDER_CODE, responsibleManagerUserIds: [] })
    expect(attentionOf({ token: OLDER_CODE, responsibleManagerUserIds: [] }).kind).toBe(
      'issues',
    )
    expect(hasUncountedScans(row)).toBe(true)
  })

  it('lists them for the note under the strip', () => {
    const rows = [
      overviewRow('a', { token: OLDER_CODE }),
      overviewRow('b'),
      overviewRow('c', { token: OLDER_CODE }),
    ]
    expect(uncountedScanPortals(rows).map((row) => row.portalId)).toEqual(['a', 'c'])
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

  it('puts a Portal guests cannot use before one whose issues do not stop them', () => {
    const blocked = attentionRank(attentionOf({ token: NO_CODE }))
    const notice = attentionRank(attentionOf({ responsibleManagerUserIds: [] }))
    expect(blocked).toBeGreaterThan(notice)
    expect(notice).toBeGreaterThan(attentionRank({ kind: 'older_code' }))
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
