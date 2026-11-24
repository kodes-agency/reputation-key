import type { Pool } from 'pg'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { Review } from '../domain/review-types'

export const ORG = organizationId('review-reobserve-org-a')
export const OTHER_ORG = organizationId('review-reobserve-org-b')
export const PROPERTY = propertyId('ae000000-0000-4000-8000-000000000001')
export const REVIEW = reviewId('ae000000-0000-4000-8000-000000000002')
export const OTHER_PROPERTY = propertyId('ae000000-0000-4000-8000-000000000004')
export const OTHER_REVIEW = reviewId('ae000000-0000-4000-8000-000000000005')
export const REPLY = 'ae000000-0000-4000-8000-000000000003'
export const OBSERVED_AT = new Date('2026-08-25T12:00:00.000Z')
export const EXPIRED_AT = new Date('2026-08-24T12:00:00.000Z')
export const REFRESHED_UNTIL = new Date('2026-09-24T12:00:00.000Z')

export const REOBSERVE_TABLES = [
  'outbox_events',
  'google_reply_observation_heads',
  'google_reply_observations',
  'replies',
  'review_source_observations',
  'material_review_revisions',
  'review_source_contents',
  'review_ai_analysis_heads',
  'reviews',
]

export function reobserveReview(
  contentExpiresAt: Date,
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-1',
    externalLocationId: 'locations/reobserve',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Original review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: null,
    firstFetchedAt: new Date('2026-08-01T12:00:00.000Z'),
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt,
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 15,
    aiSourceDigest: 'a'.repeat(64),
  }
}

export async function seedReobserveProperties(pool: Pool): Promise<void> {
  const seed = (id: string, name: string, slug: string) =>
    pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $4, 'UTC')
       ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
      [id, ORG, name, slug],
    )
  await seed(PROPERTY, 'Re-observe property', 'review-reobserve-property')
  await seed(
    OTHER_PROPERTY,
    'Other re-observe property',
    'review-reobserve-property-other',
  )
}
