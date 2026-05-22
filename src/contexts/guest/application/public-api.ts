// Guest context — public API surface for cross-context consumers.
// Other contexts (metric, inbox) and shared infrastructure consume
// event types from this barrel. Per ADR-0001.

export type { ScanEvent, Rating, Feedback, ScanSource } from '../domain/types'

export { scanRecorded, ratingSubmitted, feedbackSubmitted, reviewLinkClicked } from '../domain/events'
export type {
  ScanRecorded,
  RatingSubmitted,
  FeedbackSubmitted,
  ReviewLinkClicked,
  GuestEvent,
} from '../domain/events'
