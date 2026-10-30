// The currentness fence an analysis read answers with: which source revision, analysis
// sequence, epoch and profile versions it was stored under. Split out of the output
// store adapter, which is past the file-length ratchet.
import type { ReviewAnalysisCurrentnessV1 } from '../../domain/types'

export function currentness(
  input: Readonly<{
    sourceEpoch: number
    sourceRevision: number
    analysisSequence: number
    reviewAnalysisEpoch: number
    propertyProfileVersion: number
    analysisProfileVersion: string
  }>,
): ReviewAnalysisCurrentnessV1 {
  return {
    sourceEpoch: input.sourceEpoch,
    sourceRevision: input.sourceRevision,
    analysisSequence: input.analysisSequence,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    propertyProfileVersion: input.propertyProfileVersion,
    analysisProfileVersion: input.analysisProfileVersion,
  }
}
