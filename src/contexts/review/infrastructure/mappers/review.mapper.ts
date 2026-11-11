// Review context — row ↔ domain mapper for reviews
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { reviews } from '#/shared/db/schema/review.schema'
import type { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'
import type { Review } from '../../domain/types'
import {
  reviewId,
  organizationId,
  propertyId,
  googleConnectionId,
} from '#/shared/domain/ids'
import { reviewError } from '../../domain/errors'

type ReviewRow = typeof reviews.$inferSelect
type ReviewContentRow = typeof reviewSourceContents.$inferSelect

/** The provider-content values a Review is built from. They live on the
 * content row, not on the identity row. */
export type ReviewContentFields = Readonly<{
  reviewerName: string | null
  reviewerProfilePhotoUrl: string | null
  googleReviewUrl: string | null
  rating: number | null
  text: string | null
  translatedText: string | null
  languageCode: string | null
  reviewedAt: Date | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  lastFetchedAt: Date | null
  contentExpiresAt: Date | null
  contentHash: string | null
  aiSourceByteLength: number | null
  aiSourceDigest: string | null
}>

export type ReviewHeadRow = ReviewRow & ReviewContentFields

const VALID_PLATFORMS = new Set<string>(['google'])
const VALID_RATINGS = new Set<number>([1, 2, 3, 4, 5])

export const reviewFromRow = (row: ReviewHeadRow): Review => {
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
    expiresAt: content.contentExpiresAt,
    firstFetchedAt: content.firstFetchedAt,
    ...contentFields(content),
  })

const contentFields = (content: ReviewContentRow): ReviewContentFields => ({
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
  lastFetchedAt: content.lastFetchedAt,
  contentExpiresAt: content.contentExpiresAt,
  contentHash: content.contentHash,
  aiSourceByteLength: content.aiSourceByteLength,
  aiSourceDigest: content.aiSourceDigest,
})

/** A Review row whose content row is gone: every provider value is absent. */
export const reviewHeadWithoutContent = (row: ReviewRow): ReviewHeadRow => ({
  ...row,
  reviewerName: null,
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: null,
  text: null,
  translatedText: null,
  languageCode: null,
  reviewedAt: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  lastFetchedAt: null,
  contentExpiresAt: null,
  contentHash: null,
  aiSourceByteLength: null,
  aiSourceDigest: null,
})
