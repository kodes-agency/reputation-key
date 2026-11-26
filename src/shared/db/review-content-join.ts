import { and, eq } from 'drizzle-orm'
import { reviewSourceContents } from './schema/review-source-content.schema'
import { reviews } from './schema/review.schema'

/**
 * The join from a Review to its source content. The key is all three columns:
 * the content row carries the Organization and Property, so the join can never
 * pair a Review with another tenant's content.
 */
export const reviewContentJoin = and(
  eq(reviewSourceContents.reviewId, reviews.id),
  eq(reviewSourceContents.organizationId, reviews.organizationId),
  eq(reviewSourceContents.propertyId, reviews.propertyId),
)
