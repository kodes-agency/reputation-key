import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  reviews,
  replies,
  googleReplyObservationHeads,
} from '#/shared/db/schema/review.schema'
import type { AiReviewSourcePort } from '../../application/ports/ai-review-source.port'

/** Current local Reply OR Google-observed reply truth makes a prefetch ineligible. */
export async function hasCurrentReplyForAi(
  db: Database,
  input: Parameters<AiReviewSourcePort['hasCurrentReply']>[0],
): Promise<boolean> {
  const [row] = await db
    .select({
      // Explicit aliases: column objects inside a select-field template render
      // unqualified, which would correlate each subquery with itself.
      answered: sql<boolean>`
    EXISTS (SELECT 1 FROM ${replies} AS local_reply
      WHERE local_reply.review_id = ${input.reviewId}
      AND local_reply.organization_id = ${input.organizationId})
    OR EXISTS (SELECT 1 FROM ${googleReplyObservationHeads} AS observed
      WHERE observed.review_id = ${input.reviewId}
      AND observed.organization_id = ${input.organizationId}
      AND observed.property_id = ${input.propertyId}
      AND observed.state = 'live')
  `,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.id, input.reviewId),
        eq(reviews.organizationId, input.organizationId),
        eq(reviews.propertyId, input.propertyId),
      ),
    )
    .limit(1)
  // A missing review is not eligible for background work.
  return row?.answered ?? true
}
