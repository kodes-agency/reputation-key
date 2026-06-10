/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports domain types. Per boundary rules: external code may import
 * from `application/public-api` but NOT from `domain/`.
 *
 * DTOs, events, and select port types used by cross-context consumers
 * are exported here. Remaining port types live in
 * `application/internal-ports.ts` for internal/adapter use only.
 */
export type { GoogleReview, StarRating } from '../domain/types'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type {
  ReviewCreated,
  ReviewUpdated,
  ReviewExpired,
  ReviewReplyPublished,
  ReviewReplySubmitted,
  ReviewReplyApproved,
  ReviewReplyRejected,
  ReviewReplyPublishFailed,
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
} from '../domain/events'

// Port types needed by cross-context consumers (e.g., integration context)
export type { GoogleReviewApiPort } from './ports/google-review-api.port'
export type {
  ReviewQueuePort,
  SyncPropertyReviewsJobData,
  AddSyncJobOptions,
} from './ports/review-queue.port'

// ── Staff type aliases for cross-context consumers ──────────────────────
export type StaffRecentReview = {
  id: string
  rating: number
  snippet: string
  date: string
}
