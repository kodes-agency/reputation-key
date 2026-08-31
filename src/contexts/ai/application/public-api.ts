// AI context — supported cross-context and presentation-facing contract.
// Consumers must not import AI domain, ports, adapters, jobs, or provider
// control directly. Composition roots may wire infrastructure through build.ts.

export type {
  AiCategoryCount,
  AiPropertyAggregateWindowRead,
  AiSentimentDay,
  ReadPropertyAggregatesInput,
} from './use-cases/read-property-aggregates'

export type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './use-cases/generate-reply-suggestion'

export type {
  AiCapability,
  AiProcessingCellResult,
  ReviewAnalysisCurrentnessV1,
  ReviewAnalysisReadV1,
} from '../domain/types'
export type { AiTrendReportRead } from './ports/ai-output-store.port'
export type { ReviewAnalysisEnrollmentReadiness } from './use-cases/read-review-analysis-enrollment-readiness'
export type { ReviewAnalysisEnrollmentFence } from './ports/ai-review-analysis-enrollment.port'
export {
  EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
  isReviewAnalysisRevisionSetEvidence,
} from './ports/ai-review-analysis-enrollment.port'

export type {
  AiEvent,
  AiPropertyTrendGenerationRequested,
  AiReviewAnalysisBackfillRequested,
} from '../domain/events'
export {
  aiPropertyTrendGenerationRequested,
  aiReviewAnalysisBackfillRequested,
} from '../domain/events'

export type { AiError, AiErrorCode } from '../domain/errors'
export { isAiError } from '../domain/errors'
