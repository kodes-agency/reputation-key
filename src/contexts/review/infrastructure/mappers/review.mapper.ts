// Review context — row ↔ domain mapper for reviews
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { reviews } from '#/shared/db/schema/review.schema'
import type { Review } from '../../domain/types'
import {
  unbrand,
  reviewId,
  organizationId,
  propertyId,
  googleConnectionId,
} from '#/shared/domain/ids'

type ReviewRow = typeof reviews.$inferSelect
type ReviewInsertRow = typeof reviews.$inferInsert

export const reviewFromRow = (row: ReviewRow): Review => ({
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
  rating: row.rating as Review['rating'],
  text: row.text,
  languageCode: row.languageCode,
  reviewedAt: row.reviewedAt,
  expiresAt: row.expiresAt,
  sentimentLabel: row.sentimentLabel,
  sentimentScore: row.sentimentScore,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
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
  rating: review.rating,
  text: review.text,
  languageCode: review.languageCode,
  reviewedAt: review.reviewedAt,
  expiresAt: review.expiresAt,
  sentimentLabel: review.sentimentLabel,
  sentimentScore: review.sentimentScore,
})
