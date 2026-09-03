// AI context — supported cross-context and presentation-facing contract.
// Consumers must not import AI domain, ports, adapters, jobs, or provider
// control directly. Composition roots may wire infrastructure through build.ts.

export type {
  AiCategoryCount,
  AiSentimentDay,
} from './use-cases/read-property-aggregates'

export type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './use-cases/generate-reply-suggestion'

export type { AiTrendReportRead } from './ports/ai-output-store.port'

export type {
  AiEvent,
  AiPropertyTrendGenerationRequested,
  AiReviewAnalysisBackfillRequested,
} from '../domain/events'
