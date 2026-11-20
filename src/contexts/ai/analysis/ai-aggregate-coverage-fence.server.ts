// The coverage fence of one aggregate head, read under `FOR SHARE` inside the
// caller's transaction: the trend store compares it before it records an
// outcome and the trend report read compares it to say whether analysis has
// caught up.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { releasedAwaitingSequenceCountSql } from '#/shared/db/review-analysis-released-sequences'

export type AggregateCoverageInput = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
}>

/**
 * The coverage fence of one aggregate head. `expectedSettlementCount` is every
 * sequence after the authorization's start up to the review head, less the ones
 * the Review writer gave back; the aggregate is complete when `settledCount`
 * equals it.
 *
 * `settledCount` is the head's own `settled_analysis_count`, as the aggregate
 * read and the trend scheduler count it, not the settlement ledger: the ledger
 * spans profile versions and would call a rolled profile generation caught up
 * while its head still waits for a rebuild.
 */
export async function readAggregateCoverageFence(
  tx: Pick<Database, 'execute'>,
  input: AggregateCoverageInput,
  analysisStartSequence: number,
): Promise<
  | Readonly<{
      terminalAnalysisSequence: number
      aggregateRevision: number
      settledCount: number
      expectedSettlementCount: number
    }>
  | undefined
> {
  const startSequence = sql`${analysisStartSequence}::bigint`
  const result = await tx.execute<{
    terminalAnalysisSequence: number
    aggregateRevision: number
    settledCount: number
    expectedSettlementCount: number
  }>(sql`
    SELECT (
             review_head."head_sequence" - ${startSequence}
             - ${releasedAwaitingSequenceCountSql({
               organizationId: sql`aggregate."organization_id"`,
               propertyId: sql`aggregate."property_id"`,
               sourceEpoch: sql`aggregate."source_epoch"`,
               reviewAnalysisEpoch: sql`aggregate."review_analysis_epoch"`,
               startSequence,
               headSequence: sql`review_head."head_sequence"`,
             })}
           )::float8 AS "expectedSettlementCount",
           aggregate."terminal_analysis_sequence"::float8 AS "terminalAnalysisSequence",
           aggregate."aggregate_revision"::float8 AS "aggregateRevision",
           aggregate."settled_analysis_count"::float8 AS "settledCount"
    FROM "review_ai_analysis_heads" AS review_head
    INNER JOIN "ai_property_aggregate_heads" AS aggregate
      ON aggregate."organization_id" = review_head."organization_id"
     AND aggregate."property_id" = review_head."property_id"
     AND aggregate."source_epoch" = review_head."source_epoch"
    WHERE review_head."organization_id" = ${input.organizationId}
      AND review_head."property_id" = ${input.propertyId}::uuid
      AND review_head."source_epoch" = ${input.sourceEpoch}
      AND aggregate."review_analysis_epoch" = ${input.reviewAnalysisEpoch}
      AND aggregate."property_profile_version" = ${input.propertyProfileVersion}
    FOR SHARE OF review_head, aggregate
  `)
  return result.rows[0]
}
