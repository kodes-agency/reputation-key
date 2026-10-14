// The aggregate head of one Property profile generation: its lock, the
// watermark it inherits, and the count of sequences it has settled.
//
// The settlement ledger (`ai_property_aggregate_settlements`) is deliberately
// independent of the profile version, so an epoch's idempotency survives a
// profile rollover. Coverage is read from the head's own
// `settled_analysis_count` instead, because the daily aggregates it summarises
// are profile-scoped: a freshly rolled generation has no rows behind it and
// must report incomplete until it is rebuilt.

import { and, count, eq, exists, ne, sql } from 'drizzle-orm'
import {
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
} from '#/shared/db/schema'
import type {
  AggregateHead,
  AggregateIdentityInput,
  AggregateTransaction,
} from './ai-property-aggregate-contributions'

export function safeSequence(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

type AggregateProgressRow = Readonly<{
  terminalAnalysisSequence: number | string
  settledCount: number | string
}>

async function readInheritedAggregateProgress(
  tx: Pick<AggregateTransaction, 'execute'>,
  input: Readonly<{
    organizationId: string
    propertyId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
  }>,
): Promise<Readonly<{ terminalAnalysisSequence: number; settledCount: number }>> {
  const progress = await tx.execute<AggregateProgressRow>(sql`
    SELECT
      COALESCE((
        SELECT max(head.terminal_analysis_sequence)
        FROM ai_property_aggregate_heads AS head
        WHERE head.organization_id = ${input.organizationId}
          AND head.property_id = ${input.propertyId}::uuid
          AND head.source_epoch = ${input.sourceEpoch}
          AND head.review_analysis_epoch = ${input.reviewAnalysisEpoch}
      ), 0)::float8 AS "terminalAnalysisSequence",
      count(*)::float8 AS "settledCount"
    FROM ai_property_aggregate_settlements AS settlement
    WHERE settlement.organization_id = ${input.organizationId}
      AND settlement.property_id = ${input.propertyId}::uuid
      AND settlement.source_epoch = ${input.sourceEpoch}
      AND settlement.review_analysis_epoch = ${input.reviewAnalysisEpoch}
  `)
  const terminalAnalysisSequence = safeSequence(
    progress.rows[0]?.terminalAnalysisSequence,
  )
  const settledCount = safeSequence(progress.rows[0]?.settledCount)
  if (terminalAnalysisSequence === null || settledCount === null) {
    throw new Error('Property aggregate progress is invalid')
  }
  return { terminalAnalysisSequence, settledCount }
}

function headKey(input: AggregateIdentityInput) {
  return and(
    eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
    eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
    eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
    eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
    eq(aiPropertyAggregateHeads.propertyProfileVersion, input.propertyProfileVersion),
  )
}

export async function lockAggregateHead(
  tx: AggregateTransaction,
  input: AggregateIdentityInput,
): Promise<AggregateHead> {
  // The terminal sequence is generation identity and is inherited as a
  // max-watermark. `settledAnalysisCount` is deliberately NOT inherited: the
  // ledger spans profile versions, but the daily aggregates and contributions
  // this head summarises do not, so a new profile generation genuinely has zero
  // coverage until it is rebuilt. Inheriting the count reported a rolled
  // profile complete over an empty window.
  const inheritedProgress = await readInheritedAggregateProgress(tx, input)
  await tx
    .insert(aiPropertyAggregateHeads)
    .values({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch: input.reviewAnalysisEpoch,
      propertyProfileVersion: input.propertyProfileVersion,
      aggregateRevision: 0,
      terminalAnalysisSequence: inheritedProgress.terminalAnalysisSequence,
      settledAnalysisCount: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
  const [head] = await tx
    .select()
    .from(aiPropertyAggregateHeads)
    .where(headKey(input))
    .limit(1)
    .for('update')
  if (!head) throw new Error('Property aggregate head is missing')
  return head
}

/**
 * The head's `settled_analysis_count` once the settlement just written to the
 * ledger is counted. Called after that ledger row exists, in its transaction.
 *
 * A head that is the only head of its epoch holds every ledger row of the
 * epoch, so its count is exactly the ledger's, and that is what it is set to.
 * Besides counting the new row this repairs a head that earlier missed a stale
 * sequence (the ledger row was written, the head never counted it), which no
 * replay can repair, for a settled sequence is never delivered again.
 *
 * With a sibling head, a rolled profile generation, the ledger spans
 * generations and cannot say which rows belong to this one, so the head counts
 * only its own settlements. Setting it from the ledger would report a rolled
 * generation complete over an empty window.
 */
function settledCountAfterSettlement(
  tx: AggregateTransaction,
  input: AggregateIdentityInput,
) {
  const siblingHeads = tx
    .select({ sibling: sql`1` })
    .from(aiPropertyAggregateHeads)
    .where(
      and(
        eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
        eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
        eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
        eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
        ne(aiPropertyAggregateHeads.propertyProfileVersion, input.propertyProfileVersion),
      ),
    )
  const epochLedger = tx
    .select({ settled: count() })
    .from(aiPropertyAggregateSettlements)
    .where(
      and(
        eq(aiPropertyAggregateSettlements.organizationId, input.organizationId),
        eq(aiPropertyAggregateSettlements.propertyId, input.propertyId),
        eq(aiPropertyAggregateSettlements.sourceEpoch, input.sourceEpoch),
        eq(aiPropertyAggregateSettlements.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
      ),
    )
  return sql`CASE
    WHEN ${exists(siblingHeads)}
    THEN ${aiPropertyAggregateHeads.settledAnalysisCount} + 1
    ELSE ${epochLedger}
  END`
}

/**
 * Counts one sequence the ledger settled but that changes nothing in the
 * aggregate. The ledger row and the head's `settled_analysis_count` have to move
 * together, because coverage compares the count with the sequences the Property
 * allocated: a settled sequence the head never counts is awaited for good, and
 * every Trend of the Property is held back with it. No revision is bumped, for
 * no day changed.
 */
export async function countSettledSequence(
  tx: AggregateTransaction,
  input: AggregateIdentityInput,
  countedAt: Date,
): Promise<void> {
  await lockAggregateHead(tx, input)
  await tx
    .update(aiPropertyAggregateHeads)
    .set({
      settledAnalysisCount: settledCountAfterSettlement(tx, input),
      updatedAt: countedAt,
    })
    .where(headKey(input))
}

export async function commitAggregateHead(
  tx: AggregateTransaction,
  input: AggregateIdentityInput,
  head: AggregateHead,
  aggregateRevision: number,
  appliedAt: Date,
): Promise<void> {
  const [updatedHead] = await tx
    .update(aiPropertyAggregateHeads)
    .set({
      aggregateRevision,
      terminalAnalysisSequence: sql`GREATEST(
        ${aiPropertyAggregateHeads.terminalAnalysisSequence},
        ${input.analysisSequence}
      )`,
      // Reached only for a NEW settlement: both callers return early on
      // `replayed` and `stale`, so this counts each settled sequence once for
      // this profile generation.
      settledAnalysisCount: settledCountAfterSettlement(tx, input),
      updatedAt: appliedAt,
    })
    .where(
      and(
        headKey(input),
        eq(aiPropertyAggregateHeads.aggregateRevision, head.aggregateRevision),
      ),
    )
    .returning({ aggregateRevision: aiPropertyAggregateHeads.aggregateRevision })
  if (updatedHead?.aggregateRevision !== aggregateRevision) {
    throw new Error('Property aggregate head update failed')
  }
}
