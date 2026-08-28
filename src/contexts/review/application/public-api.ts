/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports domain types. Per boundary rules: external code may import
 * from `application/public-api` but NOT from `domain/`.
 *
 * DTOs, events, and select port types used by cross-context consumers
 * are exported here. Remaining port types are imported directly from
 * `application/ports/` by the adapters that implement them.
 */
export type { GoogleReview, StarRating } from '../domain/types'

// BQC-5.3: reply length limit — single source of truth lives in
// domain/rules; inbox reply editor components import it from here
// (components may not import domain directly).
export { MAX_REPLY_LENGTH } from '../domain/rules'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
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
  ReviewReplyUpdated,
  ReviewReplyPublicationCancelled,
  ReviewEvent,
} from '../domain/events'
export {
  reviewCreated,
  reviewUpdated,
  reviewExpired,
  reviewReplyPublished,
  reviewReplyObserved,
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyPublicationRequested,
  reviewReplyRejected,
  reviewReplyPublishFailed,
  reviewReplyUpdated,
  reviewReplyPublicationCancelled,
  reviewGoogleReputationSnapshotVerified,
} from '../domain/events'

// Port types needed by cross-context consumers (e.g., integration context)
export type {
  GoogleReviewApiPort,
  GoogleReviewApiErrorCode,
  GoogleReviewApiError,
  GoogleReviewPage,
  GoogleReviewPageRequest,
  GoogleReviewGetRequest,
  GoogleReviewGetResult,
} from './ports/google-review-api.port'
export type {
  ReviewQueuePort,
  TargetedGoogleReviewQueuePort,
  SyncPropertyReviewsJobData,
  TargetedGoogleReviewFetchJobData,
  ReviewProviderJobData,
  AddSyncJobOptions,
} from './ports/review-queue.port'
export type { TargetedGoogleReviewReferenceResolver } from './ports/targeted-google-review-reference.port'
// Sync-job attribution literal. Review owns the queue payload contract, so the
// integration webhook path stamps the same constant the sync handler matches on
// (push liveness → discovery backoff ladder). The discovery sweep's own
// initiator id stays internal to the review context, where its only user lives.
export {
  GBP_PUSH_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
} from './ports/review-queue.port'
export type {
  ReviewProviderObservationWriter,
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
  ReviewProviderSnapshotFailureCode,
} from './ports/review-provider-snapshot.repository'
export type {
  RunReviewProviderSnapshot,
  RunReviewProviderSnapshotInput,
  RunReviewProviderSnapshotResult,
} from './use-cases/run-review-provider-snapshot'
export type {
  RunTargetedGoogleReviewFetch,
  RunTargetedGoogleReviewFetchInput,
  RunTargetedGoogleReviewFetchResult,
} from './use-cases/run-targeted-google-review-fetch'
export {
  collectReviewSourceContentLifecycleReport,
  type CollectReviewSourceContentLifecycleReportInput,
  type ReviewSourceContentLifecycleReportSummary,
} from './use-cases/collect-source-content-lifecycle-report'
export { REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE } from './use-cases/run-source-content-lifecycle'
// BQC-1.7: lifecycle purge port consumed by integration + property use cases.
export type {
  SourceContentPurge,
  SourcePurgeContinuation,
  SourcePurgeResult,
} from './ports/source-content-purge.port'
export type {
  ReviewCurrentReplyObservationPermit,
  ReviewReplyObservationAuthority,
  ReviewReplyObservationAuthorityResult,
  ReviewReplyObservationExpectation,
} from './ports/reply-observation-authority.port'
export type {
  ReviewCurrentResponseTargetPermit,
  ReviewCurrentInboxProjectionPermit,
  ReviewInboxProjectionEventKind,
  ReviewInboxProjectionExpectation,
  ReviewInboxProjectionRevisionPermit,
  ReviewProviderObservationOrigin,
  ReviewResponseTargetAuthority,
  ReviewResponseTargetAuthorityResult,
  ReviewResponseTargetEligibility,
  ReviewResponseTargetExpectation,
} from './ports/response-target-authority.port'
export type {
  ReviewCurrentSourceTransitionPermit,
  ReviewSourceTransitionAuthority,
  ReviewSourceTransitionAuthorityResult,
  ReviewSourceTransitionChange,
  ReviewSourceTransitionExpectation,
} from './ports/source-transition-authority.port'
export type {
  AmbiguousPublicationReconciliationCandidate,
  AmbiguousPublicationReconciliationCursor,
  FindAmbiguousPublicationReconciliationCandidates,
  PublicationReconciliationCandidateQuery,
} from './ports/publication-reconciliation-maintenance.port'
export type {
  ReconcileReplyPublication,
  ReconcileReplyPublicationInput,
} from './use-cases/reconcile-reply-publication'
export type {
  ReviewLifecycleRecoveryApprovalConfiguration,
  ReviewLifecycleRecoveryAuthorityFactory,
} from './recovery-maintenance'

// BQC-5.5: review-owned governed aggregate serving reads (ADR 0031
// eligibility enforced at the owner, clock-injected). The dashboard build
// depends on this type; composition wires the infrastructure implementation.
export type { ReviewServingStats } from './ports/serving-stats.port'
export type {
  AiReviewSourcePort,
  AiReviewObservation,
  AiReviewSourceDenial,
  AiReviewSourceExpectation,
  AiReviewSourceRequest,
  AiReviewSourceResult,
  AiReviewCurrentSource,
  AiReviewCurrentSourceResult,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
  AiTrendPopulationReview,
} from './ports/ai-review-source.port'

// ── Staff type aliases for cross-context consumers ──────────────────────
export type StaffRecentReview = {
  id: string
  rating: number
  snippet: string
  date: string
}
