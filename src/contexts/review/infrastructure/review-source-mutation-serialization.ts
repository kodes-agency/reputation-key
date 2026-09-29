import { and, eq } from 'drizzle-orm'
import { properties } from '#/shared/db/schema/property.schema'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { lockReplyTruthScope } from './reply-truth-serialization'

/**
 * Canonical Review source-mutation prefix:
 *
 *   Property/source epoch -> Reply truth -> Review row -> provider mapping
 *
 * Callers acquire the Review row and any provider mapping only after this
 * helper returns. Lifecycle apply uses the same order in bulk. Operations that
 * do not need the Property/source epoch may begin at Reply truth, but no path
 * may acquire Property after Reply truth or Review.
 *
 * The Property row is a fence on `source_epoch`, never updated here, so it is
 * taken `FOR NO KEY UPDATE`. That still excludes every other fence holder
 * (`lock_review_ai_analysis_head_v1` takes the same mode) and every epoch
 * writer (`FOR UPDATE` then `UPDATE`), but it lets the foreign-key checks of
 * rows referencing the Property (metric readings, AI settlements,
 * notifications) through. As `FOR UPDATE` it queued them behind every review
 * import (closed beta, 2026-09-29). `FOR SHARE` would not be safe: a caller
 * that later needed exclusivity would upgrade across the Reply-truth lock.
 */
export async function lockReviewSourceMutationScope(
  tx: Tx,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    reviewId: ReviewId
    sourceEpoch: number
  }>,
): Promise<boolean> {
  const rows = await tx
    .select({ sourceEpoch: properties.sourceEpoch })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, input.organizationId),
        eq(properties.id, input.propertyId),
      ),
    )
    .for('no key update')
    .limit(1)
  if (rows[0]?.sourceEpoch !== input.sourceEpoch) return false
  await lockReplyTruthScope(tx, input.organizationId, input.reviewId)
  return true
}
