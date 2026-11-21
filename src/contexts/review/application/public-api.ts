/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports domain types. Per boundary rules: external code may import
 * from `application/public-api` but NOT from `domain/`.
 *
 * DTOs, events, and select port types used by cross-context consumers
 * are exported here. Remaining port types are imported directly from
 * `application/ports/` by the adapters that implement them.
 */
import type { Tx } from '#/shared/outbox/commit'

export type {
  GoogleReview,
  Review,
  Reply,
  StarRating,
} from '../../reputation/domain/review-types'
export type { ReplyModeration } from '../../reputation/domain/reply-moderation'
export type { ReplyDraftCheckDto } from './dto/reply-library.dto'

export { unfilledReplySlotsMessage } from '../../reputation/domain/review-rules'

// What the Reputation reply writer needs to decide a Reply write. Review keeps
// the rules; the writer applies them inside its own transactions.
export { reviewError } from '../../reputation/domain/review-errors'
export { aiTextRuleOf } from '../../reputation/domain/reply-ai-text'
export { googleReplyTextDigest } from '../../reputation/domain/google-reply-observation'
export {
  hasPublicationRecord,
  replyCommandMayStart,
} from '../../reputation/domain/reply-command-preconditions'
export type { ReplyCommand } from '../../reputation/domain/reply-command-preconditions'
export type {
  PersistedPublicationState,
  PublicationFailureClass,
} from '../../reputation/domain/reply-publication-workflow'
export type { ReplyCommandStore } from '../../reputation/replies/reply-command-store.port.server'
export type {
  ConditionalReplyUpdate,
  ReplyRepository,
} from '../../reputation/replies/reply-repository.port.server'
export type { ReplyWriter, UncertainSendSnapshot } from './ports/reply-writer.port'
export { UNCERTAIN_ATTEMPT_OUTCOMES } from './ports/reply-writer.port'

// Event re-exports — cross-context consumers must import events from public-api, not reputation/domain/review-events
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
} from '../../reputation/domain/review-events'
export {
  reviewCreated,
  reviewUpdated,
  reviewExpired,
  reviewReplyPublished,
  reviewReplyPublicationRequested,
} from '../../reputation/domain/review-events'

// Port types needed by cross-context consumers (e.g., integration context)
export type {
  GoogleConnectionStatusPort,
  GoogleReviewApiPort,
  GoogleReviewApiErrorCode,
  GoogleReviewApiError,
  GoogleReviewPageRequest,
  GoogleReviewGetRequest,
} from './ports/google-review-api.port'
export type { TargetedGoogleReviewReferenceResolver } from './ports/targeted-google-review-reference.port'
// Review owns the queue payload contract; Integration enqueues through it, so
// the port types are part of the public surface. The context boundary forbids exposing
// repositories and stores, not the queue contract another context must satisfy.
export type {
  ReviewQueuePort,
  TargetedGoogleReviewQueuePort,
} from './ports/review-queue.port'
// Sync-job attribution literal. Review owns the queue payload contract, so the
// integration webhook path stamps the same constant the sync handler matches on
// (push liveness → discovery backoff ladder). The discovery sweep's own
// initiator id stays internal to the review context, where its only user lives.
export { GBP_PUSH_SYNC_INITIATOR_ID } from './ports/review-queue.port'
// A process with no Google provider throws an error carrying this code from
// every call; the Integration build stamps it, Review's read tells it apart.
export {
  GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE,
  googleReviewApiNotConfigured,
} from './ports/google-review-api.port'
// The one translation from a provider failure into the Review product error.
export {
  executorErrorToReviewApiError,
  isGoogleReviewApiError,
  isProviderCallFailure,
  isReplyPreReadRefusal,
  REPLY_PRE_READ_REFUSAL_OPERATION,
  reviewApiError,
  translatedGoogleReviewApi,
} from './google-review-api-error'
export { collectReviewSourceContentLifecycleReport } from './use-cases/collect-source-content-lifecycle-report'
export { REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE } from './use-cases/run-source-content-lifecycle'
// Lifecycle purge port consumed by integration + property use cases.
export type { SourceContentPurge } from '../../reputation/content/source-content-purge.port.server'
export type { ReviewReplyObservationAuthority } from '../../reputation/reviews/reply-observation-authority.port.server'
export type {
  ReviewInboxProjectionExpectation,
  ReviewInboxProjectionRevisionPermit,
  ReviewResponseTargetAuthority,
  ReviewResponseTargetAuthorityResult,
  ReviewResponseTargetExpectation,
} from '../../reputation/reviews/response-target-authority.port.server'
export type { ReviewSourceTransitionAuthority } from '../../reputation/reviews/source-transition-authority.port.server'
// Inbox reads one review from Google before it releases a Response Target
// reminder for it; the result is content-free.
export type {
  CheckReviewOnGoogle as ReviewGoogleReviewCheck,
  CheckReviewOnGoogleInput,
  CheckReviewOnGoogleResult,
} from '../../reputation/sync/check-review-on-google.server'
export type {
  AmbiguousPublicationReconciliationCandidate,
  FindAmbiguousPublicationReconciliationCandidates,
} from '../../reputation/publication/publication-reconciliation-candidate-repository.port.server'
export type {
  ReconcileReplyPublication,
  ReconcileReplyPublicationInput,
} from '../../reputation/publication/reconcile-reply-publication.server'
// D5: what "Check Google again" found. The inbox reply actions render these
// outcomes, so the result shape is part of the public surface.
export type {
  CheckReplyPublication,
  ReplyPublicationCheckOutcome,
  ReplyPublicationCheckResult,
} from '../../reputation/publication/check-reply-publication.server'

// Review-owned governed aggregate serving reads (ADR 0031
// eligibility enforced at the owner, clock-injected). The dashboard build
// depends on this type; composition wires the infrastructure implementation.
export type { ReviewServingStats } from '../../reputation/reviews/serving-stats.port.server'
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
  GoogleRatingWeekHistory,
  GoogleRatingYearTotals,
  GoogleShownNumber,
  ReviewGoogleRatingReads,
} from '../../reputation/reviews/google-rating-reads.port.server'
export type {
  AiReviewSourcePort,
  AiReviewSentence,
  AiReviewSourceReadRequest,
  AiReviewCurrentSource,
  AiTrendPopulationReview,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
} from '../../reputation/reviews/ai-review-source.port.server'

/** Fixes onboarding history before Integration commits receipt-backed success. */
export type PrepareGoogleImportSync = (
  transaction: Tx,
  scope: Readonly<{ organizationId: string; propertyId: string; sourceEpoch: number }>,
) => Promise<void>
