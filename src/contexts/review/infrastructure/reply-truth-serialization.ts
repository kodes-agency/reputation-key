import { sql } from 'drizzle-orm'
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
