import { describe, expect, it } from 'vitest'
import type { ReviewCheck } from '#/contexts/portal/application/public-api'
import { MAX_PORTALS_PER_PUBLISH_BATCH } from '#/contexts/portal/application/dto/publish-portal-changes.dto'
import {
  batchEntryOf,
  blockedReasons,
  describeBatchSummary,
  describeEntry,
  describeOutcome,
  describeOutcomesSummary,
  idsToPublish,
  PUBLISH_BATCH_SIZE,
  totalsOf,
  type BatchEntry,
  type BatchReviewFacts,
} from './property-look-batch-rules'

const check = (
  code: ReviewCheck['code'],
  status: ReviewCheck['status'] = 'passed',
  locale: ReviewCheck['locale'] = null,
): ReviewCheck => ({ code, status, locale, keys: [] })

const review = (patch: Partial<BatchReviewFacts> = {}): BatchReviewFacts => ({
  action: 'publish_changes',
  nothingToPublish: false,
  canPublish: true,
  publishesAsVersion: 7,
  changes: [
    {
      type: 'edit',
      kind: 'property_brand_profile',
      subject: { area: 'look', facet: null },
      propertyWide: true,
      actor: null,
      occurredAt: '2026-10-01T09:00:00.000Z',
      previousText: null,
      newText: null,
      editCount: 1,
    },
    {
      type: 'unrecorded',
      kind: 'property_brand_profile',
      actor: null,
      occurredAt: '2026-10-01T09:00:00.000Z',
    },
  ],
  changesMayBeIncomplete: false,
  checks: [check('property_available')],
  ...patch,
})

describe('batchEntryOf — what the batch can do with one live portal', () => {
  it('is ready when the review lets the viewer publish, with the version and the change count', () => {
    expect(batchEntryOf(review())).toEqual({
      kind: 'ready',
      version: 7,
      changeCount: 2,
      changesMayBeIncomplete: false,
    })
  })

  it('does not count a change that cannot be named', () => {
    const entry = batchEntryOf(
      review({ changes: [{ type: 'unlisted' }, { type: 'no_visible_change' }] }),
    )
    expect(entry).toMatchObject({ kind: 'ready', changeCount: 0 })
  })

  it('passes on that the ledger page may have left older changes out', () => {
    expect(batchEntryOf(review({ changesMayBeIncomplete: true }))).toMatchObject({
      changesMayBeIncomplete: true,
    })
  })

  it('has nothing to publish when the live version already says what the draft says', () => {
    expect(
      batchEntryOf(review({ nothingToPublish: true, canPublish: false, changes: [] })),
    ).toEqual({ kind: 'nothing' })
  })

  it('asks nothing of the gates when there is nothing to publish, as the server does', () => {
    const blocked = [check('google_destination', 'blocked')]
    expect(
      batchEntryOf(
        review({ nothingToPublish: true, canPublish: false, checks: blocked }),
      ),
    ).toEqual({ kind: 'nothing' })
  })

  it('is blocked, in words, when a check stops the publication', () => {
    const entry = batchEntryOf(
      review({
        canPublish: false,
        checks: [check('google_destination', 'blocked'), check('property_available')],
      }),
    )
    expect(entry).toEqual({
      kind: 'blocked',
      reasons: ['No verified Google review address'],
    })
  })

  it('is not allowed when nothing is blocked but the viewer may not publish', () => {
    expect(batchEntryOf(review({ canPublish: false }))).toEqual({ kind: 'not_allowed' })
  })

  it('is no longer live when the portal has left the published state since the page loaded', () => {
    expect(batchEntryOf(review({ action: 'publish', canPublish: false }))).toEqual({
      kind: 'not_live',
    })
    expect(batchEntryOf(review({ action: 'none', canPublish: false }))).toEqual({
      kind: 'not_live',
    })
  })

  it('is unreadable when the review could not be read', () => {
    expect(batchEntryOf(null)).toEqual({ kind: 'unreadable' })
  })
})

describe('blockedReasons', () => {
  it('names each blocked check once and the languages it concerns', () => {
    expect(
      blockedReasons([
        check('property_available', 'blocked'),
        check('responsible_manager', 'blocked'),
        check('public_address', 'blocked'),
        check('primary_text', 'blocked', 'en'),
        check('primary_text', 'blocked', 'bg'),
        check('language_packs', 'blocked', 'de'),
        check('time_zone', 'blocked'),
      ]),
    ).toEqual([
      'The Property is not active',
      'Nobody is responsible for it',
      'No public address',
      'Text missing in English and Bulgarian',
      'No guest text for German',
      'Its time zone is not valid',
    ])
  })

  it('leaves out warnings and checks that passed', () => {
    expect(
      blockedReasons([check('copied_text', 'warning', 'bg'), check('time_zone')]),
    ).toEqual([])
  })
})

describe('describeEntry — the line under a portal', () => {
  const cases: ReadonlyArray<readonly [BatchEntry, string]> = [
    [
      { kind: 'ready', version: 7, changeCount: 3, changesMayBeIncomplete: false },
      'Publishes as version 7 · 3 changes',
    ],
    [
      { kind: 'ready', version: 7, changeCount: 1, changesMayBeIncomplete: false },
      'Publishes as version 7 · 1 change',
    ],
    [
      { kind: 'ready', version: 7, changeCount: 0, changesMayBeIncomplete: false },
      'Publishes as version 7',
    ],
    [
      { kind: 'ready', version: 7, changeCount: 100, changesMayBeIncomplete: true },
      'Publishes as version 7 · at least 100 changes',
    ],
    [{ kind: 'nothing' }, 'Nothing new to publish'],
    [
      { kind: 'blocked', reasons: ['No public address', 'Nobody is responsible for it'] },
      'Cannot be published · No public address; Nobody is responsible for it',
    ],
    [{ kind: 'not_allowed' }, 'You cannot publish this portal'],
    [{ kind: 'not_live' }, 'No longer live'],
    [{ kind: 'unreadable' }, 'Could not be checked'],
  ]
  it.each(cases)('%j reads %s', (entry, text) => {
    expect(describeEntry(entry)).toBe(text)
  })
})

describe('totals and the summary line', () => {
  const entries: readonly BatchEntry[] = [
    { kind: 'ready', version: 2, changeCount: 1, changesMayBeIncomplete: false },
    { kind: 'ready', version: 4, changeCount: 1, changesMayBeIncomplete: false },
    { kind: 'nothing' },
    { kind: 'blocked', reasons: ['No public address'] },
    { kind: 'unreadable' },
    { kind: 'not_allowed' },
  ]

  it('counts what will be published, what has nothing new, what cannot, and the rest', () => {
    expect(totalsOf(entries)).toEqual({ ready: 2, nothing: 1, blocked: 1, other: 2 })
  })

  it('says it all in one line', () => {
    expect(describeBatchSummary(totalsOf(entries))).toBe(
      '2 to publish · 1 with nothing new · 1 cannot be published · 2 not available',
    )
  })

  it('says only what there is', () => {
    expect(describeBatchSummary({ ready: 1, nothing: 0, blocked: 0, other: 0 })).toBe(
      '1 to publish',
    )
    expect(describeBatchSummary({ ready: 0, nothing: 0, blocked: 0, other: 0 })).toBe(
      'No live portals',
    )
  })
})

describe('idsToPublish — what is ticked', () => {
  const rows = [
    {
      portalId: 'a',
      entry: { kind: 'ready', version: 2, changeCount: 1, changesMayBeIncomplete: false },
    },
    {
      portalId: 'b',
      entry: { kind: 'ready', version: 3, changeCount: 1, changesMayBeIncomplete: false },
    },
    { portalId: 'c', entry: { kind: 'blocked', reasons: [] } },
  ] as const

  it('takes every ready portal that was not left out, in the order shown', () => {
    expect(idsToPublish(rows, new Set(['b']))).toEqual(['a'])
    expect(idsToPublish(rows, new Set())).toEqual(['a', 'b'])
  })
})

const published = (portalId: string, version: number) =>
  ({
    portalId,
    outcome: 'published',
    version,
    snapshotId: `snap-${portalId}`,
    configurationDigest: 'digest',
    activatedAt: new Date('2026-10-01T10:00:00.000Z'),
  }) as const

describe('outcomes', () => {
  it('describes what happened to each portal', () => {
    expect(describeOutcome(published('a', 8))).toEqual({
      text: 'Published as version 8',
      tone: 'ok',
    })
    expect(describeOutcome({ portalId: 'a', outcome: 'unchanged', version: 7 })).toEqual({
      text: 'Already up to date',
      tone: 'quiet',
    })
    expect(
      describeOutcome({
        portalId: 'a',
        outcome: 'failed',
        code: 'portal_not_found',
        message: 'portal not found',
      }),
    ).toEqual({ text: 'Not published · portal not found', tone: 'warn' })
  })

  it('sums them up', () => {
    expect(
      describeOutcomesSummary([
        published('a', 8),
        published('b', 3),
        { portalId: 'c', outcome: 'unchanged', version: 7 },
        { portalId: 'd', outcome: 'failed', code: 'portal_not_found', message: 'gone' },
      ]),
    ).toBe('2 published · 1 already up to date · 1 not published')
  })
})

describe('PUBLISH_BATCH_SIZE', () => {
  it('is what the server accepts in one request', () => {
    expect(PUBLISH_BATCH_SIZE).toBe(MAX_PORTALS_PER_PUBLISH_BATCH)
  })
})
