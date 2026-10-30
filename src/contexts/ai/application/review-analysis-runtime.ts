// AI context — which review-analysis contract a build runs (contract section 2.2).
//
// The runtime capability catalogue names, for review analysis, the operation
// profile this build serves. v2 is the only one it can hold today: its parser
// refuses any other entry, so v3 is unreachable until the activation slice widens
// the catalogue and changes this row. This reads the row, not a flag, so the
// moment it names `review-analysis-v3` the composition root builds the v3
// contract and every check that compares against the catalogue (the notice in
// force, the served deployment profile) already agrees with it.

import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import { REVIEW_ANALYSIS_V3_VERSIONS } from '#/shared/review-analysis-v3'

export type ReviewAnalysisContractVersion = 'v2' | 'v3'

export function selectedReviewAnalysisContractVersion(): ReviewAnalysisContractVersion {
  // Widened on purpose: the catalogue's type names only the profiles it can hold
  // today, and the comparison below is the seam activation uses.
  const selected: string =
    getAiRuntimeCapability('review_analysis').operationProfileVersion
  if (selected === 'review-analysis-v2') return 'v2'
  if (selected === REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation) return 'v3'
  throw new TypeError('The runtime catalogue selects an unknown review analysis profile')
}
