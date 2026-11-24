import { and, eq, sql } from 'drizzle-orm'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  reviews,
} from '#/shared/db/schema/review.schema'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'

/**
 * One PostgreSQL transaction-scoped authority serializes Google-reply head
 * writes with publication authorization and claim decisions for a Review.
 */
export async function lockReplyTruthScope(
  tx: Tx,
  organizationId: OrganizationId,
  reviewId: ReviewId,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-reply-observation:${organizationId}:${reviewId}`}, 0))`,
  )
}

type ReplyTruthIds = Readonly<{
  organizationId: OrganizationId
  reviewId: ReviewId
  propertyId: string
}>

/** The Review row, locked for the rest of the transaction. Call after
 * `lockReplyTruthScope`; null when the Review is not in this Property. */
export async function lockReplyTruthReview(tx: Tx, ids: ReplyTruthIds) {
  const rows = await tx
    .select({
      propertyId: reviews.propertyId,
      sourceEpoch: reviews.sourceEpoch,
      materialReviewRevision: reviews.sourceRevision,
      sourceContentState: reviews.sourceContentState,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.id, ids.reviewId),
        eq(reviews.organizationId, ids.organizationId),
        eq(reviews.propertyId, ids.propertyId),
      ),
    )
    .for('update')
    .limit(1)
  return rows[0] ?? null
}

/** The current observation head with its observation, locked after the Review. */
export function lockCurrentReplyTruthHead(tx: Tx, ids: ReplyTruthIds) {
  return tx
    .select({
      observationRevision: googleReplyObservationHeads.observationRevision,
      sourceEpoch: googleReplyObservationHeads.sourceEpoch,
      materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
      state: googleReplyObservationHeads.state,
      readGeneration: googleReplyObservations.readGeneration,
      normalizedDigest: googleReplyObservations.normalizedDigest,
      source: googleReplyObservations.source,
      contentState: googleReplyObservations.contentState,
      observedAt: googleReplyObservations.observedAt,
    })
    .from(googleReplyObservationHeads)
    .innerJoin(
      googleReplyObservations,
      eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
    )
    .where(
      and(
        eq(googleReplyObservationHeads.reviewId, ids.reviewId),
        eq(googleReplyObservationHeads.organizationId, ids.organizationId),
        eq(googleReplyObservationHeads.propertyId, ids.propertyId),
      ),
    )
    .for('update', { of: googleReplyObservationHeads })
    .limit(1)
}
