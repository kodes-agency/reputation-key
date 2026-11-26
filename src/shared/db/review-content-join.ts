// The join from a Review to its source content. The key is all three columns:
// the Organization and Property ride in the join so a content row can only meet
// the Review it belongs to, whatever the query's own `where` says.

import { and, eq } from 'drizzle-orm'
import { reviews } from '#/shared/db/schema/review.schema'
import { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'

export const reviewContentJoin = and(
  eq(reviewSourceContents.reviewId, reviews.id),
  eq(reviewSourceContents.organizationId, reviews.organizationId),
  eq(reviewSourceContents.propertyId, reviews.propertyId),
)
