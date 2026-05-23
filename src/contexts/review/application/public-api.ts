/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports domain types. Per boundary rules: external code may import
 * from `application/public-api` but NOT from `domain/`.
 *
 * Only DTOs and events are exported here. Raw port types live in
 * `application/internal-ports.ts` for internal/adapter use only.
 */
export type { GoogleReview, StarRating } from '../domain/types'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type {
  ReviewCreated,
  ReviewUpdated,
  ReplyPublished,
  ReviewEvent,
  ReplyEvent,
} from '../domain/events'
export { reviewCreated, reviewUpdated, replyPublished } from '../domain/events'
