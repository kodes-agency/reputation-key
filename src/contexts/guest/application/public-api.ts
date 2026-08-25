// Guest context — public API surface for cross-context consumers.
// Other contexts (metric, inbox) and shared infrastructure consume
// event types from this barrel. Per ADR-0001.

export type { ScanEvent, Rating, Feedback, ScanSource } from '../domain/types'

export {
  guestScanRecorded,
  guestRatingSubmitted,
  guestRatingRetracted,
  guestFeedbackSubmitted,
  guestFeedbackRetracted,
  guestReviewLinkClicked,
} from '../domain/events'
export type {
  GuestScanRecorded,
  GuestRatingSubmitted,
  GuestRatingRetracted,
  GuestFeedbackSubmitted,
  GuestFeedbackRetracted,
  GuestReviewLinkClicked,
  GuestEvent,
} from '../domain/events'
