// Review context — row ↔ domain mapper for reviews
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { reviews } from '#/shared/db/schema/review.schema'
import type { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'
import type { Review } from '../../domain/types'
import {
  unbrand,
  reviewId,
  organizationId,
  propertyId,
  googleConnectionId,
} from '#/shared/domain/ids'
import { reviewError } from '../../domain/errors'

type ReviewRow = typeof reviews.$inferSelect
type ReviewInsertRow = typeof reviews.$inferInsert
type ReviewContentRow = typeof reviewSourceContents.$inferSelect

const VALID_PLATFORMS = new Set<string>(['google'])
const VALID_RATINGS = new Set<number>([1, 2, 3, 4, 5])

export const reviewFromRow = (row: ReviewRow): Review => {
  // F040: Validate platform and rating from DB rows instead of bare type assertions
  if (!VALID_PLATFORMS.has(row.platform)) {
    throw reviewError('invalid_row', `Invalid review platform from DB: ${row.platform}`, {
      field: 'platform',
      value: row.platform,
    })
  }
  if (!VALID_RATINGS.has(row.rating ?? 0)) {
    throw reviewError('invalid_row', `Invalid review rating from DB: ${row.rating}`, {
      field: 'rating',
      value: row.rating,
    })
  }
  if (
    row.sourceContentState !== 'active' ||
    row.externalId == null ||
    row.externalLocationId == null ||
    row.reviewedAt == null ||
    row.expiresAt == null ||
    row.aiSourceByteLength == null ||
    row.aiSourceDigest == null
  ) {
    throw reviewError('invalid_row', 'Review source content is unavailable', {
      field: 'sourceContentState',
      value: row.sourceContentState,
    })
  }

  return {
    id: reviewId(row.id),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    platform: row.platform as Review['platform'],
    externalId: row.externalId,
    externalLocationId: row.externalLocationId,
    googleConnectionId: row.googleConnectionId
      ? googleConnectionId(row.googleConnectionId)
      : null,
    reviewerName: row.reviewerName,
    reviewerProfilePhotoUrl: row.reviewerProfilePhotoUrl,
    googleReviewUrl: row.googleReviewUrl,
    rating: row.rating as Review['rating'],
    text: row.text,
    translatedText: row.translatedText,
    languageCode: row.languageCode,
    reviewedAt: row.reviewedAt,
    expiresAt: row.expiresAt,
    sentimentLabel: row.sentimentLabel,
    sentimentScore: row.sentimentScore,
    sourceCreatedAt: row.sourceCreatedAt ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt ?? null,
    firstFetchedAt: row.firstFetchedAt ?? null,
    lastFetchedAt: row.lastFetchedAt ?? null,
    contentExpiresAt: row.contentExpiresAt ?? null,
    contentHash: row.contentHash ?? null,
    sourceSeenGeneration: row.sourceSeenGeneration ?? null,
    sourceEpoch: row.sourceEpoch,
    sourceRevision: row.sourceRevision,
    analysisSequence: row.analysisSequence,
    aiSourceByteLength: row.aiSourceByteLength,
    aiSourceDigest: row.aiSourceDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * A Review whose provider content comes from its erasable content row. The
 * Review row supplies identity, the tombstone state and the fences
 * (epoch, revision, analysis sequence); the content row supplies everything the
 * provider sent and the fetch clocks.
 */
export const reviewFromRows = (row: ReviewRow, content: ReviewContentRow): Review =>
  reviewFromRow({
    ...row,
    externalId: content.externalId,
    externalLocationId: content.externalLocationId,
    googleConnectionId: content.googleConnectionId,
    reviewerName: content.reviewerName,
    reviewerProfilePhotoUrl: content.reviewerProfilePhotoUrl,
    googleReviewUrl: content.googleReviewUrl,
    rating: content.rating,
    text: content.text,
    translatedText: content.translatedText,
    languageCode: content.languageCode,
    reviewedAt: content.reviewedAt,
    sourceCreatedAt: content.sourceCreatedAt,
    sourceUpdatedAt: content.sourceUpdatedAt,
    firstFetchedAt: content.firstFetchedAt,
    lastFetchedAt: content.lastFetchedAt,
    contentExpiresAt: content.contentExpiresAt,
    contentHash: content.contentHash,
    aiSourceByteLength: content.aiSourceByteLength,
    aiSourceDigest: content.aiSourceDigest,
  })

export const reviewToRow = (
  review: Omit<Review, 'createdAt' | 'updatedAt'>,
): ReviewInsertRow => ({
  id: unbrand(review.id),
  organizationId: unbrand(review.organizationId),
  propertyId: unbrand(review.propertyId),
  platform: review.platform,
  externalId: review.externalId,
  externalLocationId: review.externalLocationId,
  googleConnectionId:
    review.googleConnectionId != null ? unbrand(review.googleConnectionId) : null,
  reviewerName: review.reviewerName,
  reviewerProfilePhotoUrl: review.reviewerProfilePhotoUrl,
  googleReviewUrl: review.googleReviewUrl,
  rating: review.rating,
  text: review.text,
  translatedText: review.translatedText,
  languageCode: review.languageCode,
  reviewedAt: review.reviewedAt,
  expiresAt: review.expiresAt,
  sentimentLabel: review.sentimentLabel,
  sentimentScore: review.sentimentScore,
  sourceCreatedAt: review.sourceCreatedAt,
  sourceUpdatedAt: review.sourceUpdatedAt,
  firstFetchedAt: review.firstFetchedAt,
  lastFetchedAt: review.lastFetchedAt,
  contentExpiresAt: review.contentExpiresAt,
  contentHash: review.contentHash,
  sourceSeenGeneration: review.sourceSeenGeneration,
  sourceEpoch: review.sourceEpoch,
  sourceRevision: review.sourceRevision,
  analysisSequence: review.analysisSequence,
  aiSourceByteLength: review.aiSourceByteLength,
  aiSourceDigest: review.aiSourceDigest,
  sourceContentState: 'active',
  sourceContentErasedAt: null,
})
