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
  ReviewReplySubmitted,
  ReviewReplyApproved,
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
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyRejected,
  reviewReplyPublishFailed,
  reviewReplyUpdated,
  reviewReplyPublicationCancelled,
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
  SyncPropertyReviewsJobData,
  AddSyncJobOptions,
} from './ports/review-queue.port'
// Sync-job attribution literal. Review owns the queue payload contract, so the
// integration webhook path stamps the same constant the sync handler matches on
// (push liveness → discovery backoff ladder). The discovery sweep's own
// initiator id stays internal to the review context, where its only user lives.
export { GBP_PUSH_SYNC_INITIATOR_ID } from './ports/review-queue.port'
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
// BQC-1.7: lifecycle purge port consumed by integration + property use cases.
export type {
  SourceContentPurge,
  SourcePurgeResult,
} from './ports/source-content-purge.port'

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
