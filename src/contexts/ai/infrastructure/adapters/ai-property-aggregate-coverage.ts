// Coverage of one Property's aggregate head: how many settlements Review
// Analysis owes it, and how many it has.
//
// Every sequence after the authorization's start and up to the review head is
// owed a settlement, except the ones the Review writer gave back
// (`review_ai_analysis_released_sequences`, migration 0068). The released
// count is limited to that range and to the numbers no settlement already
// counts, so a number that is both is counted once, as the settlement.

import type { Database } from '#/shared/db'
import { readReleasedAwaitingSequenceCount } from '#/shared/db/review-analysis-released-sequences'
import type { AiPropertyAggregateCoverage } from '../../application/ports/ai-property-aggregate-store.port'

export async function readAnalysisCoverage(
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
