import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAtomicReviewCommandStore,
  type ProviderRestatement,
} from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import { describeReviewMaterial } from '../domain/material-review-revision'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createReviewObservationRepository } from './repositories/review-observation.repository'
import { readObservationHistory } from './testing/review-observation-history'

// On 2026-10-23 Google changed how it wraps translated review text and did not
// move updateTime. The comparison still found a difference, created Material
// Review Revision 2 on 62 reviews, reopened handled Inbox items and gave open
// ones a Response Target that was overdue from birth. A guest edit moves
// Google's updateTime; a difference at an unmoved one is Google restating the
// review, and keeps the revision. It is stored as `normalization_shadow_match`
// (the observation table's CHECK is not widened), so what separates a
// restatement from the envelope reread and a real edit is whether the store
// reports it after commit.

const ORG = organizationId('review-restatement-org-a')
const OTHER_ORG = organizationId('review-restatement-org-b')
const PROPERTY = propertyId('f9a30000-0000-4000-8000-000000000001')
const REVIEW = reviewId('f9a30000-0000-4000-8000-000000000002')
const REPLY = 'f9a30000-0000-4000-8000-000000000003'
const OBSERVED_AT = new Date('2026-10-23T04:35:00.000Z')
const UPDATED_AT = new Date('2026-08-01T12:00:00.000Z')
const UPDATED_ONE_MS_LATER = new Date(UPDATED_AT.getTime() + 1)
const EXPIRED_AT = new Date('2026-08-24T12:00:00.000Z')
const REFRESHED_UNTIL = new Date('2026-11-22T04:35:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'google_reply_observation_heads',
    'google_reply_observations',
    'replies',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_released_sequences',
    'review_ai_analysis_heads',
    'reviews',
  ],
})

function review(
  overrides: Partial<Omit<Review, 'createdAt' | 'updatedAt'>> = {},
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-restatement',
    externalLocationId: 'locations/restatement',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Original review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2027-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: UPDATED_AT,
    firstFetchedAt: new Date('2026-08-01T12:00:00.000Z'),
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt: REFRESHED_UNTIL,
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 15,
    aiSourceDigest: 'a'.repeat(64),
    ...overrides,
  }
}

const announce = (persisted: Review) =>
  (persisted.analysisSequence === 1 ? reviewCreated : reviewUpdated)({
    reviewId: persisted.id,
    propertyId: persisted.propertyId,
    organizationId: persisted.organizationId,
    platform: persisted.platform,
    sourceEpoch: persisted.sourceEpoch,
    sourceRevision: persisted.sourceRevision,
    analysisSequence: persisted.analysisSequence,
    occurredAt: OBSERVED_AT,
  })

/** One observation through the real atomic write path, keyed by its number. */
function observe(
  candidate: Omit<Review, 'createdAt' | 'updatedAt'>,
  key: number,
  providerUpdateTimeReported?: boolean,
) {
  return createAtomicReviewCommandStore(
    getDb(),
    () => OBSERVED_AT,
    undefined,
    undefined,
    replyScopeEffects,
  ).upsertAndRecord(
    candidate,
    announce,
    OBSERVED_AT,
    String(key).repeat(64),
    'ongoing',
    undefined,
    providerUpdateTimeReported,
  )
}

const comparisonsOf = async () =>
  (await readObservationHistory(getDb(), REVIEW, ORG)).map((entry) => [
    entry.observationSequence,
    entry.materialRevision,
    entry.comparison,
  ])

const replyStatus = async () =>
  (
    await getPool().query<{ status: string }>(
      `SELECT status::text AS status FROM replies WHERE id = $1 AND organization_id = $2`,
      [REPLY, ORG],
    )
  ).rows[0]?.status

const cancellationCauses = async () =>
  (
    await getPool().query<{ cause: string }>(
      `SELECT payload->>'cause' AS cause FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'review.reply.publication_cancelled'`,
      [ORG],
    )
  ).rows.map((row) => row.cause)

async function seedPendingReply(): Promise<void> {
  await getPool().query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by,
       submitted_by, ai_generated, authorship, state_revision
     ) VALUES ($1, $2, $3, 'Sorry about the room', 'pending_approval',
       'internal', 'staff-user-1', 'staff-user-2', false, 'human', 1)`,
    [REPLY, REVIEW, ORG],
  )
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Restatement property', 'review-restatement-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

const RESTATED = { rating: 3 as const, text: 'Original review, as Google now wraps it' }

describe('a review Google restated at an unmoved updateTime', () => {
  it('keeps the revision until the guest really edits, then creates the second one', async () => {
    await observe(review(), 1)
    await seedPendingReply()

    const restated = await observe(review(RESTATED), 2)
    const reread = await observe(review(RESTATED), 3)

    expect(restated.sourceRevision).toBe(1)
    expect(reread.sourceRevision).toBe(1)
    // The reread matches the restated row, so it writes no row of its own.
    expect(await comparisonsOf()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 1, 'normalization_shadow_match'],
    ])
    const history = createReviewObservationRepository(getDb())
    expect(await history.findMaterialRevisions(REVIEW, ORG)).toHaveLength(1)
    // The reply waiting for approval answers a review nobody edited.
    expect(await replyStatus()).toBe('pending_approval')
    expect(await cancellationCauses()).toEqual([])

    const edited = await observe(
      review({
        rating: 2,
        text: 'The guest rewrote it',
        sourceUpdatedAt: UPDATED_ONE_MS_LATER,
      }),
      4,
    )

    expect(edited.sourceRevision).toBe(2)
    expect(await comparisonsOf()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 1, 'normalization_shadow_match'],
      [3, 2, 'material_change'],
    ])
    expect(await history.findMaterialRevisions(REVIEW, ORG)).toHaveLength(2)
    expect(await replyStatus()).toBe('draft')
    expect(await cancellationCauses()).toEqual(['source_changed'])
  })

  it('adopts the restated digests on the review and on the revision it kept', async () => {
    await observe(review(), 1)

    await observe(review(RESTATED), 2)

    const restated = describeReviewMaterial(RESTATED)
    const head = await getPool().query<{
      material_source_digest: string
      material_normalized_digest: string
      rating: number
      text: string
    }>(
      `SELECT review.material_source_digest, review.material_normalized_digest, content.rating, content.text
         FROM reviews AS review
         JOIN review_source_contents AS content ON content.review_id = review.id
           AND content.organization_id = review.organization_id
           AND content.property_id = review.property_id
         WHERE review.id = $1 AND review.organization_id = $2`,
      [REVIEW, ORG],
    )
    expect(head.rows[0]).toEqual({
      material_source_digest: restated.sourceDigest,
      material_normalized_digest: restated.normalizedDigest,
      rating: 3,
      text: RESTATED.text,
    })
    const kept = await getPool().query<{
      revision: string
      source_digest: string
      normalized_digest: string
      rating: number
      normalized_text: string
    }>(
      `SELECT revision, source_digest, normalized_digest, rating, normalized_text
         FROM material_review_revisions WHERE review_id = $1 AND organization_id = $2`,
      [REVIEW, ORG],
    )
    expect(kept.rows).toEqual([
      {
        revision: '1',
        source_digest: restated.sourceDigest,
        normalized_digest: restated.normalizedDigest,
        rating: 3,
        normalized_text: RESTATED.text,
      },
    ])
  })

  it('announces the restatement under the revision it kept and releases no sequence', async () => {
    await observe(review(), 1)
    await observe(review(RESTATED), 2)

    const facts = await getPool().query<{ sequence: string; revision: string }>(
      `SELECT payload->>'analysisSequence' AS sequence,
              payload->>'sourceRevision' AS revision
         FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'review.updated'`,
      [ORG],
    )
    expect(facts.rows).toEqual([{ sequence: '2', revision: '1' }])
    const released = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM review_ai_analysis_released_sequences
        WHERE organization_id = $1`,
      [ORG],
    )
    expect(released.rows[0]?.count).toBe('0')
  })

  it('still counts a change when Google reports it had no updateTime to move', async () => {
    await observe(review(), 1)

    // The sync carries the stored time onto a read Google sent without one, so
    // at the writer the two look equal. Only the flag says Google reported none.
    const edited = await observe(review(RESTATED), 2, false)

    expect(edited.sourceRevision).toBe(2)
    expect(await comparisonsOf()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 2, 'material_change'],
    ])
  })
})

describe('the content row through a restatement and an edit', () => {
  const contentOf = async () =>
    (
      await getPool().query<{
        text: string
        rating: number
        source_revision: string
        ai_source_byte_length: number
        ai_source_digest: string
      }>(
        `SELECT text, rating, source_revision::text AS source_revision,
                ai_source_byte_length, ai_source_digest
           FROM review_source_contents WHERE review_id = $1 AND organization_id = $2`,
        [REVIEW, ORG],
      )
    ).rows[0]

  it('moves the revision and the AI source digest only when the guest edits', async () => {
    await observe(review(), 1)
    expect(await contentOf()).toEqual({
      text: 'Original review',
      rating: 4,
      source_revision: '1',
      ai_source_byte_length: 15,
      ai_source_digest: 'a'.repeat(64),
    })

    await observe(
      review({ ...RESTATED, aiSourceByteLength: 38, aiSourceDigest: 'b'.repeat(64) }),
      2,
    )
    // Restated: the words follow Google, the revision stays.
    expect(await contentOf()).toMatchObject({
      text: RESTATED.text,
      rating: 3,
      source_revision: '1',
    })

    await observe(
      review({
        rating: 2,
        text: 'The guest rewrote it',
        sourceUpdatedAt: UPDATED_ONE_MS_LATER,
        aiSourceByteLength: 20,
        aiSourceDigest: 'c'.repeat(64),
      }),
      3,
    )
    expect(await contentOf()).toEqual({
      text: 'The guest rewrote it',
      rating: 2,
      source_revision: '2',
      ai_source_byte_length: 20,
      ai_source_digest: 'c'.repeat(64),
    })
  })

  it('keeps the revision fence while writing the edited AI digest and byte length only to content', async () => {
    await observe(review(), 1)
    await observe(
      review({
        rating: 2,
        text: 'The guest rewrote it',
        sourceUpdatedAt: UPDATED_ONE_MS_LATER,
        aiSourceByteLength: 20,
        aiSourceDigest: 'c'.repeat(64),
      }),
      2,
    )

    const both = await getPool().query(
      `SELECT r.source_revision = c.source_revision AS same_revision,
              c.ai_source_digest AS source_digest,
              c.ai_source_byte_length AS source_length
         FROM reviews r JOIN review_source_contents c ON c.review_id = r.id
        WHERE r.id = $1`,
      [REVIEW],
    )
    expect(both.rows).toEqual([
      {
        same_revision: true,
        source_digest: 'c'.repeat(64),
        source_length: 20,
      },
    ])
  })
})

describe('a review re-observed after its content expired', () => {
  it('cannot tell a restatement from an edit once erasure took the stored updateTime', async () => {
    await observe(review({ contentExpiresAt: EXPIRED_AT }), 1)

    // Erasure nulls the stored updateTime, so the net has nothing to compare:
    // a rewritten review stays a guest edit. A known limitation of a rare path.
    const store = createAtomicReviewCommandStore(
      getDb(),
      () => OBSERVED_AT,
      undefined,
      undefined,
      replyScopeEffects,
    )
    const reobserved = await store.reobserveExpiredAndRecord(
      review({ ...RESTATED, contentExpiresAt: REFRESHED_UNTIL }),
      OBSERVED_AT,
      '2'.repeat(64),
      'ongoing',
    )

    expect(reobserved.sourceRevision).toBe(2)
    expect(await comparisonsOf()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 2, 'material_change'],
    ])
  })

  it.each([
    { reported: true, comparison: 'normalization_shadow_match', restatements: 1 },
    { reported: false, comparison: 'material_change', restatements: 0 },
  ])(
    'carries an older-epoch review as $comparison when updateTime reported is $reported',
    async ({ reported, comparison, restatements }) => {
      await observe(review({ contentExpiresAt: EXPIRED_AT }), 1)
      await getPool().query('UPDATE properties SET source_epoch = 1 WHERE id = $1', [
        PROPERTY,
      ])

      // The older epoch's row is not erased, so it still holds its updateTime.
      const report = vi.fn<(restatement: ProviderRestatement) => void>()
      const store = createAtomicReviewCommandStore(
        getDb(),
        () => OBSERVED_AT,
        undefined,
        report,
        replyScopeEffects,
      )
      await store.reobserveExpiredAndRecord(
        review({ ...RESTATED, sourceEpoch: 1, contentExpiresAt: REFRESHED_UNTIL }),
        OBSERVED_AT,
        '2'.repeat(64),
        'ongoing',
        reported,
      )

      expect(await comparisonsOf()).toEqual([
        [1, 1, 'initial_material_revision'],
        [2, 2, comparison],
      ])
      // The restatement rule is what kept it a carry, so it is what is reported.
      expect(report).toHaveBeenCalledTimes(restatements)
    },
  )
})

describe('the report of a review Google restated', () => {
  const reportingStore = () => {
    const report = vi.fn<(restatement: ProviderRestatement) => void>()
    const store = createAtomicReviewCommandStore(
      getDb(),
      () => OBSERVED_AT,
      undefined,
      report,
      replyScopeEffects,
    )
    return { report, store }
  }
  const observeThrough = (
    store: ReturnType<typeof reportingStore>['store'],
    candidate: Omit<Review, 'createdAt' | 'updatedAt'>,
    key: number,
  ) =>
    store.upsertAndRecord(
      candidate,
      announce,
      OBSERVED_AT,
      String(key).repeat(64),
      'ongoing',
    )

  it('names the review once, by its ids alone, and only for the restatement', async () => {
    const { report, store } = reportingStore()

    await observeThrough(store, review(), 1)
    await observeThrough(store, review(RESTATED), 2)
    await observeThrough(store, review(RESTATED), 3)
    await observeThrough(
      store,
      review({
        rating: 2,
        text: 'The guest rewrote it',
        sourceUpdatedAt: UPDATED_ONE_MS_LATER,
      }),
      4,
    )

    expect(report.mock.calls).toEqual([
      [{ organizationId: ORG, propertyId: PROPERTY, reviewId: REVIEW }],
    ])
  })

  it('does not report the replay of a restatement it already reported', async () => {
    const { report, store } = reportingStore()
    await observeThrough(store, review(), 1)
    await observeThrough(store, review(RESTATED), 2)

    await observeThrough(store, review(RESTATED), 2)

    expect(report).toHaveBeenCalledTimes(1)
  })

  it('reports nothing for a write that did not commit', async () => {
    const report = vi.fn<(restatement: ProviderRestatement) => void>()
    const failing = createAtomicReviewCommandStore(
      getDb(),
      () => OBSERVED_AT,
      async (tx, input) => {
        const { persistReviewObservation } =
          await import('./repositories/review-observation.repository')
        await persistReviewObservation(tx, input)
        throw new Error('the transaction fails after the observation')
      },
      report,
      replyScopeEffects,
    )
    await observeThrough(
      createAtomicReviewCommandStore(
        getDb(),
        () => OBSERVED_AT,
        undefined,
        undefined,
        replyScopeEffects,
      ),
      review(),
      1,
    )

    await expect(observeThrough(failing, review(RESTATED), 2)).rejects.toThrow(
      'the transaction fails after the observation',
    )

    expect(report).not.toHaveBeenCalled()
    expect(await comparisonsOf()).toEqual([[1, 1, 'initial_material_revision']])
  })
})
