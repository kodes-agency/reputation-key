// Review AI-analysis sequences that were allocated and then released
// (migration 0068, ADR 0058 amendment 2026-10-22).
//
// `lock_review_ai_analysis_head_v1` raises a source epoch's `head_sequence` by
// one for each observation the Review writer is about to apply, and coverage
// owes one settlement for every number in (analysis_start_sequence,
// head_sequence]. A transaction that commits the raised head without stamping a
// Review or writing an event leaves a number nobody holds. The Review writer
// records such a number in `review_ai_analysis_released_sequences` in the same
// transaction (`releaseAnalysisSequence`), and every reader of coverage
// subtracts the rows that fall inside the range and are not also settled
// (`releasedAwaitingSequenceCountSql`).
//
// One definition of "owed" for the stall monitor, the aggregate read, the trend
// scheduler and the trend store, so none can drift from the others.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  reviewAiAnalysisReleasedSequences,
  type ReleasedSequenceReason,
} from '#/shared/db/schema/review-analysis-released-sequences.schema'
import type { Tx } from '#/shared/outbox/commit'

export type { ReleasedSequenceReason }

export type ReleasedSequenceScope = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
}>

/**
 * Record that an allocated sequence was given back. Idempotent: a number
 * already released keeps its first reason and instant. Runs in the transaction
 * that allocated the number, so the head and the ledger move together.
 */
export async function releaseAnalysisSequence(
  tx: Tx,
  scope: ReleasedSequenceScope,
  analysisSequence: number,
  reason: ReleasedSequenceReason,
): Promise<void> {
  if (!Number.isSafeInteger(analysisSequence) || analysisSequence < 1) {
    throw new RangeError('A released analysis sequence must be a positive safe integer')
  }
  await tx
    .insert(reviewAiAnalysisReleasedSequences)
    .values({
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      sourceEpoch: scope.sourceEpoch,
      analysisSequence,
      reason,
    })
    .onConflictDoNothing()
}

/** SQL expressions for the columns that bound one Property's coverage. */
export type CoverageBounds = Readonly<{
  organizationId: SQL
  propertyId: SQL
  sourceEpoch: SQL
  reviewAnalysisEpoch: SQL
  /** `merchant_ai_enablement.analysis_start_sequence`: exclusive lower bound. */
  startSequence: SQL
  /** `review_ai_analysis_heads.head_sequence`: inclusive upper bound. */
  headSequence: SQL
}>

/**
 * A scalar subquery (bigint): how many released sequences in
 * (start, head] of the source epoch no settlement already counts. Coverage
 * expects `head - start - this` settlements. A released sequence that was
 * somehow settled too is counted once, as the settlement.
 */
export function releasedAwaitingSequenceCountSql(bounds: CoverageBounds): SQL {
  return sql`(
    SELECT count(*)
    FROM "review_ai_analysis_released_sequences" AS released_sequence
    WHERE released_sequence."organization_id" = ${bounds.organizationId}
      AND released_sequence."property_id" = ${bounds.propertyId}
      AND released_sequence."source_epoch" = ${bounds.sourceEpoch}
      AND released_sequence."analysis_sequence" > ${bounds.startSequence}
      AND released_sequence."analysis_sequence" <= ${bounds.headSequence}
      AND NOT EXISTS (
        SELECT 1
        FROM "ai_property_aggregate_settlements" AS released_settlement
        WHERE released_settlement."organization_id" = released_sequence."organization_id"
          AND released_settlement."property_id" = released_sequence."property_id"
          AND released_settlement."source_epoch" = released_sequence."source_epoch"
          AND released_settlement."review_analysis_epoch" = ${bounds.reviewAnalysisEpoch}
          AND released_settlement."analysis_sequence" = released_sequence."analysis_sequence"
      )
  )`
}

export type CoverageValues = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  startSequence: number
  headSequence: number
}>

/** The same count for one Property, read with its values bound. */
export async function readReleasedAwaitingSequenceCount(
  executor: Pick<Database, 'execute'>,
  values: CoverageValues,
): Promise<number> {
  const result = await executor.execute<{ released: number | string }>(sql`
    SELECT ${releasedAwaitingSequenceCountSql({
      organizationId: sql`${values.organizationId}`,
      propertyId: sql`${values.propertyId}::uuid`,
      sourceEpoch: sql`${values.sourceEpoch}`,
      reviewAnalysisEpoch: sql`${values.reviewAnalysisEpoch}`,
      startSequence: sql`${values.startSequence}`,
      headSequence: sql`${values.headSequence}`,
    })}::float8 AS "released"
  `)
  const released = Number(result.rows[0]?.released ?? 0)
  if (!Number.isSafeInteger(released) || released < 0) {
    throw new Error('Released analysis sequence count is invalid')
  }
  return released
}
