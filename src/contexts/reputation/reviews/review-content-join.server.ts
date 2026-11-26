import { and, eq } from 'drizzle-orm'
import { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'
import { reviews } from '#/shared/db/schema/review.schema'

/**
 * Join predicate from a Review to its provider content row. The content row is
 * keyed by Organization and Property as well as the Review, so the join cannot
 * cross a tenant even if an id is reused.
 */
export const reviewContentJoin = and(
  eq(reviewSourceContents.reviewId, reviews.id),
  eq(reviewSourceContents.organizationId, reviews.organizationId),
  eq(reviewSourceContents.propertyId, reviews.propertyId),
)
