import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

// An observation older than the stored one is recorded as history without
// rewriting the content row, so it must carry the content row's expiry: the
// lifecycle inspection requires the newest observation to match the Review.

const ORG = organizationId('review-out-of-order-org-a')
const OTHER_ORG = organizationId('review-out-of-order-org-b')
const PROPERTY = propertyId('f9b10000-0000-4000-8000-000000000001')
const REVIEW = reviewId('f9b10000-0000-4000-8000-000000000002')
const NEWER_UPDATED_AT = new Date('2026-08-05T12:00:00.000Z')
const OLDER_UPDATED_AT = new Date('2026-08-02T12:00:00.000Z')
const FIRST_FETCH = new Date('2026-10-23T04:35:00.000Z')
const FIRST_EXPIRY = new Date('2026-11-22T04:35:00.000Z')
const LATER_FETCH = new Date('2026-11-02T04:35:00.000Z')
const LATER_EXPIRY = new Date('2026-12-02T04:35:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
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
    externalId: 'provider-review-out-of-order',
    externalLocationId: 'locations/out-of-order',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Newest review text',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2027-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: NEWER_UPDATED_AT,
    firstFetchedAt: FIRST_FETCH,
    lastFetchedAt: FIRST_FETCH,
    contentExpiresAt: FIRST_EXPIRY,
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
    occurredAt: FIRST_FETCH,
  })

function observe(
  candidate: Omit<Review, 'createdAt' | 'updatedAt'>,
  key: number,
  observedAt: Date,
) {
  return createAtomicReviewCommandStore(
    getDb(),
    () => observedAt,
    undefined,
    undefined,
    replyScopeEffects,
  ).upsertAndRecord(candidate, announce, observedAt, String(key).repeat(64), 'ongoing')
}

type ClockRow = { sequence: string; comparison: string; expires: Date }

const contentClock = async () =>
  (
    await getPool().query<{ last_fetched_at: Date; content_expires_at: Date }>(
      `SELECT last_fetched_at, content_expires_at FROM review_source_contents
        WHERE review_id = $1 AND organization_id = $2`,
      [REVIEW, ORG],
    )
  ).rows[0]

const observationClocks = async () =>
  (
    await getPool().query<ClockRow>(
      `SELECT observation_sequence::text AS sequence,
              comparison_result::text AS comparison,
              content_expires_at AS expires
         FROM review_source_observations
        WHERE review_id = $1 AND organization_id = $2
        ORDER BY observation_sequence`,
      [REVIEW, ORG],
    )
  ).rows

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Out of order property', 'review-out-of-order-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('an out-of-order Google observation', () => {
  it('carries the content row expiry and leaves the content row clock alone', async () => {
    await observe(review(), 1, FIRST_FETCH)
    const before = await contentClock()

    await observe(
      review({
        text: 'Older review text',
        sourceUpdatedAt: OLDER_UPDATED_AT,
        lastFetchedAt: LATER_FETCH,
        contentExpiresAt: LATER_EXPIRY,
      }),
      2,
      LATER_FETCH,
    )

    const observations = await observationClocks()
    expect(observations.map((row) => row.comparison)).toEqual([
      'initial_material_revision',
      'out_of_order_ignored',
    ])
    expect(observations[1]?.expires).toEqual(before?.content_expires_at)
    expect(observations[1]?.expires).not.toEqual(LATER_EXPIRY)
    expect(await contentClock()).toEqual(before)
    expect(before?.content_expires_at).toEqual(FIRST_EXPIRY)
    expect(before?.last_fetched_at).toEqual(FIRST_FETCH)
  })
})
