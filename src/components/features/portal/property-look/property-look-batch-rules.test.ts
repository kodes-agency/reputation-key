import { describe, expect, it } from 'vitest'
import type { ReviewCheck } from '#/contexts/portal/application/public-api'
import { MAX_PORTALS_PER_PUBLISH_BATCH } from '#/contexts/portal/application/dto/publish-portal-changes.dto'
import {
  batchEntryOf,
  blockedReasons,
  describeEntry,
  describeOutcome,
  describeOutcomesSummary,
  describeStop,
  describeUnanswered,
  PUBLISH_BATCH_SIZE,
  type BatchEntry,
  type BatchReviewFacts,
} from './property-look-batch-rules'

const check = (
  code: ReviewCheck['code'],
  status: ReviewCheck['status'] = 'passed',
  locale: ReviewCheck['locale'] = null,
  keys: ReviewCheck['keys'] = [],
): ReviewCheck => ({ code, status, locale, keys })

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
  languages: [],
  ...patch,
})

describe('batchEntryOf — what the batch can do with one live portal', () => {
  it('is ready when the review lets the viewer publish, with the version and what it carries', () => {
    expect(batchEntryOf(review())).toEqual({
      kind: 'ready',
      version: 7,
      mix: { look: 2, other: 0, hasUnlisted: false },
      changesMayBeIncomplete: false,
    })
  })

  it('counts a change that cannot be named as other edits that cannot be listed', () => {
    const entry = batchEntryOf(
      review({ changes: [{ type: 'unlisted' }, { type: 'no_visible_change' }] }),
    )
    expect(entry).toMatchObject({
      kind: 'ready',
      mix: { look: 0, other: 0, hasUnlisted: true },
    })
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
      reasons: ['No verified Google link'],
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
  it('words each blocked check as the review page does, and names a check about languages once', () => {
    expect(
      blockedReasons(
        [
          check('property_available', 'blocked'),
          check('responsible_manager', 'blocked'),
          check('public_address', 'blocked'),
          check('primary_text', 'blocked', 'en', ['title']),
          check('primary_text', 'blocked', 'bg', ['title', 'shortDescription']),
          check('language_packs', 'blocked', 'de'),
          check('language_packs', 'blocked', 'fr'),
          check('google_destination', 'blocked'),
          check('time_zone', 'blocked'),
        ],
        [],
      ),
    ).toEqual([
      'The property is unavailable',
      'No one is responsible for this portal',
      'No working code',
      'English · 1 text missing, Български · 2 texts missing',
      'Deutsch and Français have no guest wording yet',
      'No verified Google link',
      'The property’s time zone is not valid',
    ])
  })

  it('says a single language by itself', () => {
    expect(blockedReasons([check('language_packs', 'blocked', 'de')], [])).toEqual([
      'Deutsch has no guest wording yet',
    ])
  })

  it('leaves out warnings and checks that passed', () => {
    expect(
      blockedReasons([check('copied_text', 'warning', 'bg'), check('time_zone')], []),
    ).toEqual([])
  })
})

const ready = (
  mix: Partial<{ look: number; other: number; hasUnlisted: boolean }>,
  changesMayBeIncomplete = false,
): BatchEntry => ({
  kind: 'ready',
  version: 7,
  mix: { look: 0, other: 0, hasUnlisted: false, ...mix },
  changesMayBeIncomplete,
})

describe('describeEntry — the line under a portal', () => {
  const cases: ReadonlyArray<readonly [BatchEntry, string]> = [
    [ready({ look: 3 }), 'Publishes as version 7 · the look only'],
    [
      ready({ look: 1, other: 2 }),
      'Publishes as version 7 · also publishes 2 other draft edits',
    ],
    [
      ready({ look: 1, other: 1 }),
      'Publishes as version 7 · also publishes 1 other draft edit',
    ],
    [ready({}), 'Publishes as version 7'],
    [
      ready({ look: 1, other: 100 }, true),
      'Publishes as version 7 · also publishes at least 100 other draft edits',
    ],
    [
      ready({ look: 1 }, true),
      'Publishes as version 7 · the look, and possibly other edits',
    ],
    [
      ready({ look: 1, hasUnlisted: true }),
      'Publishes as version 7 · also publishes other draft edits',
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

describe('portals with no answer', () => {
  it('says a portal of the request that failed may have been published, and that trying again is safe', () => {
    expect(describeUnanswered('unconfirmed')).toEqual({
      text: 'Not confirmed · may have been published; trying again is safe',
      tone: 'warn',
    })
  })

  it('says a portal of a later request was never sent', () => {
    expect(describeUnanswered('untried')).toEqual({
      text: 'Not tried · stopped before it',
      tone: 'warn',
    })
  })
})

describe('describeStop — the alert when a request failed as a whole', () => {
  it('puts the server’s sentence in its own sentence, and does not claim the failed request’s portals were untouched', () => {
    const text = describeStop('Portals are switched off here', { untried: 0 })
    expect(text).toBe(
      'Publishing stopped: Portals are switched off here. The portals in that request may or may not have been published; trying again is safe.',
    )
    expect(text).not.toMatch(/not touched/i)
  })

  it('does not double a full stop the sentence already has', () => {
    expect(describeStop('Wait a moment.', { untried: 0 })).toMatch(
      /^Publishing stopped: Wait a moment\. The portals/,
    )
  })

  it('says the later portals were not sent', () => {
    expect(describeStop('Gone', { untried: 3 })).toMatch(/ The others were not sent\.$/)
  })
})
