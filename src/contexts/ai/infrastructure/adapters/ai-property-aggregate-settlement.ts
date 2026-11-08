// Settlement identity spans processing profiles. The caller holds the Property
// advisory lock and owns the transaction that also updates contributions and coverage.
import { and, desc, eq } from 'drizzle-orm'
import { aiPropertyAggregateSettlements } from '#/shared/db/schema'
import { countSettledSequence } from './ai-property-aggregate-head'
import type {
  AggregateIdentityInput,
  AggregateTransaction,
} from './ai-property-aggregate-contributions'

type ReviewSettlementInput = AggregateIdentityInput & Readonly<{ reviewId: string }>

async function readLatestReviewSettlement(
  tx: AggregateTransaction,
  input: Readonly<{
    organizationId: string
    propertyId: string
    reviewId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
  }>,
) {
  const [settlement] = await tx
    .select({
      analysisSequence: aiPropertyAggregateSettlements.analysisSequence,
    })
    .from(aiPropertyAggregateSettlements)
    .where(
      and(
        eq(aiPropertyAggregateSettlements.organizationId, input.organizationId),
        eq(aiPropertyAggregateSettlements.propertyId, input.propertyId),
        eq(aiPropertyAggregateSettlements.reviewId, input.reviewId),
        eq(aiPropertyAggregateSettlements.sourceEpoch, input.sourceEpoch),
        eq(aiPropertyAggregateSettlements.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
      ),
    )
    .orderBy(desc(aiPropertyAggregateSettlements.analysisSequence))
    .limit(1)
  return settlement
}

async function recordAggregateSettlement(
  tx: AggregateTransaction,
  input: Readonly<{
    organizationId: string
    propertyId: string
    reviewId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
    analysisSequence: number
  }>,
  settledAt: Date,
): Promise<boolean> {
  const [inserted] = await tx
    .insert(aiPropertyAggregateSettlements)
    .values({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch: input.reviewAnalysisEpoch,
      analysisSequence: input.analysisSequence,
      settledAt,
    })
    .onConflictDoNothing()
    .returning({ reviewId: aiPropertyAggregateSettlements.reviewId })
  if (inserted) return true

  const [existing] = await tx
    .select({ reviewId: aiPropertyAggregateSettlements.reviewId })
    .from(aiPropertyAggregateSettlements)
    .where(
      and(
        eq(aiPropertyAggregateSettlements.organizationId, input.organizationId),
        eq(aiPropertyAggregateSettlements.propertyId, input.propertyId),
        eq(aiPropertyAggregateSettlements.sourceEpoch, input.sourceEpoch),
        eq(aiPropertyAggregateSettlements.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
        eq(aiPropertyAggregateSettlements.analysisSequence, input.analysisSequence),
      ),
    )
    .limit(1)
  if (existing?.reviewId !== input.reviewId) {
    throw new Error('Property aggregate settlement identity conflict')
  }
  return false
}
export async function settleReviewSequence(
  tx: AggregateTransaction,
  input: ReviewSettlementInput,
  settledAt: Date,
): Promise<'new' | 'replayed' | 'stale'> {
  const latest = await readLatestReviewSettlement(tx, input)
  const firstSettlement = await recordAggregateSettlement(tx, input, settledAt)
  if (latest?.analysisSequence === input.analysisSequence) return 'replayed'
  if (latest !== undefined && latest.analysisSequence > input.analysisSequence) {
    // Superseded sequences still count toward coverage, once per ledger row.
    if (firstSettlement) await countSettledSequence(tx, input, settledAt)
    return 'stale'
  }
  return firstSettlement ? 'new' : 'replayed'
}

/**
 * Missing analysis or source content still settles a sequence for coverage,
 * without changing the contribution revision.
 */
export async function settleWithoutContribution(
  tx: AggregateTransaction,
  input: ReviewSettlementInput,
  settlement: 'new' | 'replayed',
  settledAt: Date,
  status: 'stale' | 'unavailable',
): Promise<{ status: 'stale' | 'unavailable' }> {
  if (settlement === 'new') await countSettledSequence(tx, input, settledAt)
  return { status }
}
