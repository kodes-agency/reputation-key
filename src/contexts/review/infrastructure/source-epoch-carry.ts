import { and, asc, eq, inArray } from 'drizzle-orm'
import { reviewSourceObservations } from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { ReviewMaterialComparison } from '../domain/material-review-revision'

/** What Review compares to decide whether a Material Revision was only carried. */
export type SourceEpochCarryEvidence = Readonly<{
  sourceEpoch: number
  normalizationVersion: string
  normalizedDigest: string | null
}>

/** Comparison outcomes that find no guest change: an observation with one of
 * these creates a revision only because the source epoch moved on. */
const NO_MATERIAL_CHANGE: ReadonlySet<string> = new Set<ReviewMaterialComparison>([
  'unchanged',
  'normalization_shadow_match',
  'baseline_unavailable',
])

/**
 * Archive/Restore, a Google relink and disconnect/reconnect advance the
 * Property's source epoch, and the next sync re-binds every unchanged Review to
 * it as the next numbered Material Revision (moving the old row would rewrite
 * historical reply foreign keys). Review is the only context entitled to call
 * two revisions business-equivalent, so it attests the carry: the immediate
 * predecessor sits in an older epoch and held the same normalized material, or
 * — for a predecessor recorded before material digests existed — the
 * observation that created the revision found no material change. A guest edit
 * is never a carry, whichever epoch it lands in.
 */
export function isSourceEpochCarry(
  predecessor: SourceEpochCarryEvidence,
  revision: SourceEpochCarryEvidence,
  bindingComparison: string | null,
): boolean {
  if (predecessor.sourceEpoch >= revision.sourceEpoch) return false
  const sameMaterial =
    revision.normalizedDigest !== null &&
    predecessor.normalizationVersion === revision.normalizationVersion &&
    predecessor.normalizedDigest === revision.normalizedDigest
  return (
    sameMaterial ||
    (bindingComparison !== null && NO_MATERIAL_CHANGE.has(bindingComparison))
  )
}

/**
 * The comparison Review recorded for the first observation of each revision —
 * the observation that created it. Only epoch-crossing revisions need it, so
 * callers pass those and an ordinary history costs no query.
 */
export async function selectRevisionBindingComparisons(
  tx: Tx,
  scope: Readonly<{ organizationId: string; reviewId: string }>,
  revisions: readonly number[],
): Promise<ReadonlyMap<number, string>> {
  if (revisions.length === 0) return new Map()
  const rows = await tx
    .selectDistinctOn([reviewSourceObservations.materialRevision], {
      revision: reviewSourceObservations.materialRevision,
      comparison: reviewSourceObservations.comparisonResult,
    })
    .from(reviewSourceObservations)
    .where(
      and(
        eq(reviewSourceObservations.organizationId, scope.organizationId),
        eq(reviewSourceObservations.reviewId, scope.reviewId),
        inArray(reviewSourceObservations.materialRevision, [...revisions]),
      ),
    )
    .orderBy(
      asc(reviewSourceObservations.materialRevision),
      asc(reviewSourceObservations.observationSequence),
    )
  return new Map(rows.map((row) => [row.revision, row.comparison]))
}
