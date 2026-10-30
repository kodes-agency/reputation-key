// AI context — supported cross-context and presentation-facing contract.
// Consumers must not import AI domain, ports, adapters, jobs, or provider
// control directly. Composition roots may wire infrastructure through build.ts.

export type {
  AiAspectAggregate,
  AiEmergingIssue,
  AiSentimentDay,
} from './use-cases/read-property-aggregates'

export {
  PROPERTY_INSIGHTS_RANGES,
  isPropertyInsightsRange,
} from './use-cases/read-property-insights'
export type {
  AiPropertyInsightAspect,
  AiPropertyInsightAspectEvidenceState,
  AiPropertyInsightComparedAspect,
  AiPropertyInsightIssue,
  AiPropertyInsightsAllTimeReady,
  AiPropertyInsightsBasis,
  AiPropertyInsightsPresetReady,
  AiPropertyInsightsRatingBucket,
  AiPropertyInsightsRead,
  AiPropertyInsightsWindow,
  AiPropertyInsightWeeklyPoint,
  AiPropertyInsightWeeklySeries,
  PropertyInsightsPreset,
  PropertyInsightsRange,
} from './use-cases/read-property-insights'

// Guest voice 2.0: what the page and the issue drawer are drawn from. `Window`,
// `Change` and `EvidenceLevel` are the read model's own names; they leave here
// prefixed, so a consumer's `Window` is still the browser's.
export type {
  GuestVoiceV2Range,
  GuestVoiceV2Response,
} from './use-cases/read-guest-voice-v2'
export type {
  ChangedItem,
  FixFirstItem,
  GuestsLoveItem,
  GuestVoiceV2NotEnough,
  GuestVoiceV2Read,
  GuestVoiceV2Ready,
  InShortLine,
  IssueDrawer,
  IssueStatistics,
  LatestReview,
  LiveEvidence,
  StaffPraiseLine,
  TopicRow,
  WatchItem,
  Change as GuestVoiceChange,
  EvidenceLevel as GuestVoiceEvidenceLevel,
  Window as GuestVoiceWindow,
} from './read-models/guest-voice-v2'
// The vocabulary is the v3 analysis's own (`src/shared`); the page speaks of an Urgent
// "reason", not of a review-analysis one.
export type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
export type { ReviewUrgentReasonV3 as UrgentReasonV3 } from '#/shared/review-analysis-v3'

export type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from './use-cases/generate-reply-suggestion'

export type {
  CorrectReviewMentionResult,
  MentionCorrectionAction,
} from './use-cases/correct-review-mention'

export type { AiTrendReportRead } from './ports/ai-output-store.port'
export type { AiTrendReportView, AiTrendSupportingReviewView } from './trend-report-view'

export type {
  AiEvent,
  AiPropertyTrendGenerationRequested,
  AiReviewAnalysisBackfillRequested,
} from '../domain/events'
export type { ReviewAnalysisProgress } from './use-cases/read-review-analysis-progress'
export type { RequestReviewAnalysisNowResult } from './use-cases/request-review-analysis-now'
export type { AiOrganizationMonthSpend } from './ports/ai-organization-spend.port'
