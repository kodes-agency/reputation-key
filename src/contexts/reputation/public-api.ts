/**
 * Reputation's public API: the one file another area may import. Review, Inbox
 * and Reputation are one bounded context, so their surfaces are all here.
 *
 * It is server code: it re-exports Reputation's server writers. A browser file
 * takes only types from it (`import type`); browser values come from the
 * feature contracts (`inbox/contracts.ts`, `library/contracts.ts`,
 * `replies/contracts.ts`).
 */
import type { Tx } from '#/shared/outbox/commit'
import type { ResponseTargetStore } from './response-targets/store.port.server'
import type { UpdateInboxStatus } from './inbox/update-inbox-status.server'
import type { BulkUpdateInboxStatus } from './inbox/bulk-update-inbox-status.server'
import type { BulkAssignInboxItems } from './inbox/bulk-assign-inbox-items.server'
import type { EscalateInboxItem } from './inbox/escalate-inbox-item.server'
import type { ResolveEscalation } from './inbox/resolve-escalation.server'
import type { SetInboxItemPriority } from './inbox/set-inbox-item-priority.server'
import type { AssignInboxItem } from './inbox/assign-inbox-item.server'
import type { GetInboxItems } from './inbox/get-inbox-items.server'
import type { AddInboxNote } from './inbox/add-inbox-note.server'
import type { GetLastVisitCount } from './inbox/get-last-visit-count.server'
import type { StampLastInboxView } from './inbox/stamp-last-inbox-view.server'
import type { GetInboxItemDetail } from './inbox/get-inbox-item-detail.server'
import type { CheckInboxReviewOnGoogle } from './inbox/check-inbox-review-on-google.server'
import type { GetInboxNotes } from './inbox/get-inbox-notes.server'
import type { GetInboxItemHistory } from './inbox/get-inbox-item-history.server'
import type { GetInboxQueueCounts } from './inbox/get-inbox-queue-counts.server'
import type { GetInboxPropertyCounts } from './inbox/get-inbox-property-counts.server'
import type { GetReviewInboxItemIds } from './inbox/get-review-inbox-item-ids.server'
import type { MarkFeedbackHandled } from './inbox/mark-feedback-handled.server'
import type { CorrectFeedbackHandlingOutcome } from './inbox/correct-feedback-handling-outcome.server'
import type {
  GetGoogleReviewTargetAnalytics,
  GetPrivateFeedbackTargetAnalytics,
  GetResponseTargetPolicySettings,
} from './response-targets/get-response-targets.server'
import type { SetResponseTargetPolicy } from './response-targets/set-response-target-policy.server'

// ── Reply and content storage ───────────────────────────────────────
// Any context that must end or withdraw Replies inside its transaction uses
// the scope effects.
export { replyScopeEffects } from './replies/scope-effects.server'
export {
  createInboxNotificationLookup,
  isCurrentInboxAssignee,
} from './inbox/notification-lookup.server'
export { historicalOnboardingItem } from './inbox/historical-onboarding-item.server'

// ── Review ───────────────────────────────────────────────────────────
export type { GoogleReview, Review, Reply, StarRating } from './domain/review-types'
export type { ReplyModeration } from './domain/reply-moderation'
export type { ReplyDraftCheckDto } from './library/contracts'
// The Reply library's stored template shapes, which the resolver contract reads.
export type {
  StoredReplyTemplate,
  StoredReplyTemplateVisibility,
} from './library/reply-library-repository.port.server'

export type { ReplyCommand } from './domain/reply-command-preconditions'
export type {
  PersistedPublicationState,
  PublicationFailureClass,
} from './domain/reply-publication-workflow'

// Event re-exports — cross-context consumers import events from here, not from domain/review-events.
export type {
  ReviewCreated,
  ReviewUpdated,
  ReviewExpired,
  ReviewSourceTransitioned,
  ReviewReplyPublished,
  ReviewReplyObserved,
  ReviewGoogleReputationSnapshotVerified,
  ReviewReplySubmitted,
  ReviewReplyApproved,
  ReviewReplyPublicationRequested,
  ReviewReplyRejected,
  ReviewReplyPublishFailed,
  ReplyPublishFailureOutcome,
  ReviewReplyUpdated,
  ReviewReplyPublicationCancelled,
  ReviewEvent,
} from './domain/review-events'
export {
  reviewCreated,
  reviewUpdated,
  reviewReplyPublished,
  reviewReplyPublicationRequested,
} from './domain/review-events'

// Port types needed by cross-context consumers. Integration's review-sync
// adapters implement the Google review port through these names.
export type {
  GoogleConnectionStatusPort,
  GoogleReviewApiPort,
  GoogleReviewApiErrorCode,
  GoogleReviewApiError,
  GoogleReviewApiFailure,
  GoogleReviewGetRequest,
  GoogleReviewHeadContinuation,
  GoogleReviewHeadRequest,
  GoogleReviewPageRequest,
  GoogleReviewRead,
} from './sync/google-review-api.port.server'
export type { TargetedGoogleReviewReferenceResolver } from './sync/targeted-google-review-reference.port.server'
// Review owns the queue payload contract; Integration enqueues through it, so
// the port types are part of the public surface. The context boundary forbids exposing
// repositories and stores, not the queue contract another context must satisfy.
export type {
  ReviewQueuePort,
  TargetedGoogleReviewQueuePort,
} from './sync/review-queue.port.server'
// Sync-job attribution literal. Review owns the queue payload contract, so the
// integration webhook path stamps the same constant the sync handler matches on
// (push liveness → discovery backoff ladder). The discovery sweep's own
// initiator id stays internal to Review sync, where its only user lives.
export { GBP_PUSH_SYNC_INITIATOR_ID } from './sync/review-queue.port.server'
// A process with no Google provider throws an error carrying this code from
// every call; the Integration build stamps it, Review's read tells it apart.
export {
  GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
  googleReviewApiNotConfigured,
} from './sync/google-review-api.port.server'
// The one translation from a provider failure into the Review product error.
export {
  executorErrorToReviewApiError,
  isGoogleReviewApiError,
  isProviderCallFailure,
  REPLY_PRE_READ_REFUSAL_OPERATION,
  reviewApiError,
  translatedGoogleReviewApi,
} from './sync/google-review-api-error.server'
// Operator scripts (restore verify, the purge command) read the source-content
// lifecycle through these.
export { collectReviewSourceContentLifecycleReport } from './content/collect-source-content-lifecycle-report.server'
export {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE,
} from './content/run-source-content-lifecycle.server'
export type { ReviewReplyObservationAuthority } from './reviews/reply-observation-authority.port.server'
export type { ReviewResponseTargetAuthority } from './reviews/response-target-authority.port.server'
export type { ReviewSourceTransitionAuthority } from './reviews/source-transition-authority.port.server'
// Inbox reads one review from Google before it releases a Response Target
// reminder for it; the result is content-free.
export type { CheckReviewOnGoogle as ReviewGoogleReviewCheck } from './sync/check-review-on-google.server'
export type {
  AmbiguousPublicationReconciliationCandidate,
  FindAmbiguousPublicationReconciliationCandidates,
} from './publication/publication-reconciliation-candidate-repository.port.server'
// What "Check Google again" found. The inbox reply actions render these
// outcomes, so the result shape is part of the public surface.
export type {
  ReplyPublicationCheckOutcome,
  ReplyPublicationCheckResult,
} from './publication/check-reply-publication.server'

// Review-owned governed aggregate serving reads (ADR 0031
// eligibility enforced at the owner, clock-injected). The dashboard build
// depends on this type; composition wires the infrastructure implementation.
export type { ReviewServingStats } from './reviews/serving-stats.port.server'
// Reporting's Property Google rating goal reads current Google review counts
// and star sums through this Review-owned port (eligibility enforced here).
export type {
  GoogleRatingDayCount,
  GoogleRatingHistory,
  GoogleRatingLowReview,
  GoogleRatingMonthTotals,
  GoogleRatingRange,
  GoogleRatingRangeTotals,
  GoogleRatingStarCount,
  GoogleRatingSummary,
  GoogleRatingSummaryRequest,
  GoogleRatingTotals,
  GoogleRatingYearTotals,
  GoogleShownNumber,
  ReviewGoogleRatingReads,
} from './reviews/google-rating-reads.port.server'
export type {
  AiReviewSourcePort,
  AiReviewSourceReadRequest,
  AiReviewCurrentSource,
  AiTrendPopulationReview,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
} from './reviews/ai-review-source.port.server'

/** Fixes onboarding history before Integration commits receipt-backed success. */
export type PrepareGoogleImportSync = (
  transaction: Tx,
  scope: Readonly<{ organizationId: string; propertyId: string; sourceEpoch: number }>,
) => Promise<void>

// ── Inbox ────────────────────────────────────────────────────────────
export type {
  InboxItem,
  InboxNote,
  InboxStatus,
  SourceType,
  ManualReopenReason,
  InboxItemReplyState,
  ReplyStatus,
  ReplyPublicationState,
  ReplyPublicationFailureClass,
} from './domain/inbox-types'
export type {
  FeedbackHandlingCommandResult,
  FeedbackHandlingState,
} from './inbox/feedback-handling-store.port.server'
export type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetView,
} from './response-targets/store.port.server'
export type {
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from './response-targets/policy.store.port.server'
export type { PrivateFeedbackHandlingOutcome } from './domain/feedback-handling'
export type { InboxPriority } from './domain/inbox-priority'
export type { InboxRevisionConflictResult } from './domain/inbox-errors'

// The detail result (includes the review reply) — used by the client detail
// state. See the get-inbox-item-detail use case.
export type { InboxItemDetailResult } from './inbox/get-inbox-item-detail.server'
export type { InboxGoogleCheckOutcome } from './inbox/check-inbox-review-on-google.server'
export type { InboxNoteView } from './inbox/get-inbox-notes.server'
export type { InboxError } from './domain/inbox-errors'
export type { GetInboxItemHistoryResult } from './inbox/get-inbox-item-history.server'
export type {
  Cursor,
  InboxFilters,
  InboxSort,
} from './inbox/inbox-repository.port.server'
export type { InboxQueue } from './inbox/inbox-queues.contracts'
export type { InboxQueueCounts } from './inbox/get-inbox-queue-counts.server'
export type { InboxPropertyCounts } from './inbox/get-inbox-property-counts.server'
export type {
  InboxMentionV3,
  InboxReviewAnalysis,
  ReviewAnalysisAspect,
  ReviewAspect,
  ReviewAspectPolarity,
} from './inbox/ai-review-insights.port.server'

/** Request-facing Inbox capabilities. Persistence and construction stay private. */
export type InboxPublicApi = Readonly<{
  updateInboxStatus: UpdateInboxStatus
  bulkUpdateInboxStatus: BulkUpdateInboxStatus
  bulkAssignInboxItems: BulkAssignInboxItems
  escalateInboxItem: EscalateInboxItem
  resolveEscalation: ResolveEscalation
  setInboxItemPriority: SetInboxItemPriority
  assignInboxItem: AssignInboxItem
  getInboxItems: GetInboxItems
  addInboxNote: AddInboxNote
  getLastVisitCount: GetLastVisitCount
  stampLastInboxView: StampLastInboxView
  getInboxItemDetail: GetInboxItemDetail
  checkInboxReviewOnGoogle: CheckInboxReviewOnGoogle
  getInboxNotes: GetInboxNotes
  getInboxItemHistory: GetInboxItemHistory
  getInboxQueueCounts: GetInboxQueueCounts
  getInboxPropertyCounts: GetInboxPropertyCounts
  getReviewInboxItemIds: GetReviewInboxItemIds
  markFeedbackHandled: MarkFeedbackHandled
  correctFeedbackHandlingOutcome: CorrectFeedbackHandlingOutcome
  getGoogleReviewTargetAnalytics: GetGoogleReviewTargetAnalytics
  getGoogleReviewTargetCountsByProperty: ResponseTargetStore['getGoogleReviewTargetCountsByProperty']
  getPrivateFeedbackTargetAnalytics: GetPrivateFeedbackTargetAnalytics
  getResponseTargetPolicySettings: GetResponseTargetPolicySettings
  setResponseTargetPolicy: SetResponseTargetPolicy
}>

// Event re-exports — cross-context consumers import event types from here, not from domain/inbox-events.
export type {
  InboxItemCreated,
  InboxItemStatusChanged,
  InboxItemEscalated,
  InboxItemAssigned,
  InboxNoteAdded,
  InboxBulkAssignmentCompleted,
  InboxAssignmentsReleased,
  InboxBulkReopenCompleted,
  InboxHandlingCycleOpened,
  InboxHandlingCycleClosed,
  InboxHandlingCycleReopened,
  InboxResponseTargetReminderDue,
  InboxResponseTargetPolicyChanged,
  InboxEvent,
} from './domain/inbox-events'
