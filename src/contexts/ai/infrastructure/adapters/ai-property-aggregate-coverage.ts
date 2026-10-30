// Coverage of one Property's aggregate head: how many settlements Review
// Analysis owes it, and how many it has.
//
// Every sequence after the authorization's start and up to the review head is
// owed a settlement, except the ones the Review writer gave back
// (`review_ai_analysis_released_sequences`, migration 0068). The released
// count is limited to that range and to the numbers no settlement already
// counts, so a number that is both is counted once, as the settlement.

import { and, eq } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { readReleasedAwaitingSequenceCount } from '#/shared/db/review-analysis-released-sequences'
import {
  aiPropertyAggregateHeads,
  merchantAiEnablement,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import type { AiPropertyAggregateCoverage } from '../../application/ports/ai-property-aggregate-store.port'

async function readAnalysisCoverage(
  executor: Pick<Database, 'execute'>,
  input: Readonly<{
    organizationId: string
    propertyId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
    settledAnalysisCount: number
    headSequence: number
    analysisStartSequence: number
  }>,
): Promise<AiPropertyAggregateCoverage> {
  const releasedSequenceCount = await readReleasedAwaitingSequenceCount(executor, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    startSequence: input.analysisStartSequence,
    headSequence: input.headSequence,
  })
  const expectedAnalysisCount =
    input.headSequence - input.analysisStartSequence - releasedSequenceCount
  if (
    !Number.isSafeInteger(expectedAnalysisCount) ||
    expectedAnalysisCount < 0 ||
    input.settledAnalysisCount > expectedAnalysisCount
  ) {
    throw new Error('Property aggregate coverage is invalid')
  }
  return Object.freeze({
    settledAnalysisCount: input.settledAnalysisCount,
    expectedAnalysisCount,
    awaitingAnalysisCount: expectedAnalysisCount - input.settledAnalysisCount,
  })
}

export type LockedAggregateHead = Readonly<{
  head: typeof aiPropertyAggregateHeads.$inferSelect
  coverage: AiPropertyAggregateCoverage
}>

/**
 * The Property's aggregate head and how far its analysis is, read together under
 * share locks so that what the caller reads next belongs to the same head: a writer
 * of this Property waits for the read, or the read waits for the writer. Null when
 * the authorization, the review head or the aggregate head is not there yet.
 *
 * Coverage is read from THIS head, not from the profile-independent settlement
 * ledger: the figures under it are profile-scoped, so a ledger count would declare a
 * freshly rolled profile complete over an empty window.
 */
export async function readLockedAggregateHead(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
    propertyProfileVersion: number
  }>,
): Promise<LockedAggregateHead | null> {
  const [authorization] = await tx
    .select({ analysisStartSequence: merchantAiEnablement.analysisStartSequence })
    .from(merchantAiEnablement)
    .where(
      and(
        eq(merchantAiEnablement.organizationId, input.organizationId),
        eq(merchantAiEnablement.propertyId, input.propertyId),
        eq(merchantAiEnablement.authorizedSourceEpoch, input.sourceEpoch),
        eq(merchantAiEnablement.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
      ),
    )
    .limit(1)
    .for('share')
  const [reviewHead] = await tx
    .select({ headSequence: reviewAiAnalysisHeads.headSequence })
    .from(reviewAiAnalysisHeads)
    .where(
      and(
        eq(reviewAiAnalysisHeads.organizationId, input.organizationId),
        eq(reviewAiAnalysisHeads.propertyId, input.propertyId),
        eq(reviewAiAnalysisHeads.sourceEpoch, input.sourceEpoch),
      ),
    )
    .limit(1)
    .for('share')
  const [head] = await tx
    .select()
    .from(aiPropertyAggregateHeads)
    .where(
      and(
        eq(aiPropertyAggregateHeads.organizationId, input.organizationId),
        eq(aiPropertyAggregateHeads.propertyId, input.propertyId),
        eq(aiPropertyAggregateHeads.sourceEpoch, input.sourceEpoch),
        eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, input.reviewAnalysisEpoch),
        eq(aiPropertyAggregateHeads.propertyProfileVersion, input.propertyProfileVersion),
      ),
    )
    .limit(1)
    .for('share')
  if (!authorization || !reviewHead || !head) return null
  const coverage = await readAnalysisCoverage(tx, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    settledAnalysisCount: head.settledAnalysisCount,
    headSequence: reviewHead.headSequence,
    analysisStartSequence: authorization.analysisStartSequence,
  })
  return { head, coverage }
}
