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
  ReviewReplyPublished,
  ReviewReplySubmitted,
  ReviewEvent,
} from '../domain/events'
export {
  reviewCreated,
  reviewUpdated,
  reviewReplyPublished,
  reviewReplySubmitted,
} from '../domain/events'

// Port types needed by cross-context consumers (e.g., integration context)
export type {
  ReviewQueuePort,
  SyncPropertyReviewsJobData,
  AddSyncJobOptions,
} from './ports/review-queue.port'
