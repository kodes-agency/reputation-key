/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports domain types. Per boundary rules: external code may import
 * from `application/public-api` but NOT from `domain/`.
 */
export type { GoogleReview, StarRating } from '../domain/types'
export type {
  ReviewQueuePort,
  SyncPropertyReviewsJobData,
  AddSyncJobOptions,
} from './ports/review-queue.port'
export type { GoogleReviewApiPort } from './ports/google-review-api.port'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type {
  ReviewCreated,
  ReviewUpdated,
  ReplyPublished,
  ReviewEvent,
  ReplyEvent,
} from '../domain/events'
export { reviewCreated, reviewUpdated, replyPublished } from '../domain/events'
