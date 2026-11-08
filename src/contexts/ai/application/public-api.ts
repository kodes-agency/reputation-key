// AI context — supported cross-context and presentation-facing contract.
// Consumers must not import AI domain, ports, adapters, jobs, or provider
// control directly. Composition roots may wire infrastructure through build.ts.

// Guest voice 2.0: what the page and the issue drawer are drawn from. `Window`,
// `Change` and `EvidenceLevel` are the read model's own names; they leave here
// prefixed, so a consumer's `Window` is still the browser's.
export type {
  GuestVoiceV2Range,
  GuestVoiceV2Response,
} from '../guest-voice/get-guest-voice.server'
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
} from '../guest-voice/contracts'
// The vocabulary is the v3 analysis's own (`src/shared`); the page speaks of an Urgent
// "reason", not of a review-analysis one.
export type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
export type { ReviewUrgentReasonV3 as UrgentReasonV3 } from '#/shared/review-analysis-v3'

export type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from '../reply/generate-suggestion.server'

export type {
  CorrectReviewMentionResult,
  MentionCorrectionAction,
} from './use-cases/correct-review-mention'

export type {
  AiEvent,
  AiPropertyTrendGenerationRequested,
  AiReviewAnalysisBackfillRequested,
  AiReviewUrgentDetected,
  AiGuestVoiceSummaryReady,
} from '../domain/events'
export type { ReviewAnalysisProgress } from './use-cases/read-review-analysis-progress'
export type { RequestReviewAnalysisNowResult } from './use-cases/request-review-analysis-now'
export type { AiOrganizationMonthSpend } from './ports/ai-organization-spend.port'

export type {
  GuestVoiceBasis,
  GuestVoiceWindowContext,
  UrgentConcernItem,
  GuestVoiceSeriousConcerns,
  RatingTrendPeriod,
  GuestVoiceRatingMonth,
  GuestVoiceRatingTrend,
  GuestVoiceTopicStatus,
  GuestVoiceTopicAssessment,
  GuestVoiceDetailTarget,
  GuestVoiceDetailRead,
  GuestVoiceConcernDrawer,
  GuestVoiceTopicDrawer,
  GuestVoiceCauseRow,
  GuestVoiceMatchingReviewScope,
  GuestVoiceHistoryMonth,
} from '../guest-voice/contracts'
export type {
  ReadGuestVoiceDetailInput,
  ReadGuestVoiceDetail,
  GuestVoiceDetailResponse,
} from '../guest-voice/get-detail.server'

// Operator commands and the worker reach history replay only through here.
export { AI_BACKLOG_DRAIN_CONCURRENCY } from '../replay/contracts'
export { createApproveReviewAnalysisEnrollment } from '../replay/approve-enrollment.server'
export { createReviewAnalysisEnrollmentAdapter } from '../replay/enrollment-store.server'
export {
  listSpentReviewAnalyses,
  reopenSpentReviewAnalyses,
} from '../replay/reopen-store.server'
