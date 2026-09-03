// Guest context — public API surface for cross-context consumers.
// Other contexts (metric, inbox) and shared infrastructure consume
// event types from this barrel. Per ADR-0001.

export type { ScanEvent, Rating, Feedback } from '../domain/types'

export type { PortalResponseIntegritySummary } from './ports/guest-response.repository'

export {
  guestScanRecorded,
  guestRatingSubmitted,
  guestFeedbackSubmitted,
  guestFeedbackRetracted,
} from '../domain/events'
export type {
  GuestQualifiedScanRecorded,
  GuestQualifiedScanRetracted,
  GuestScanRecorded,
  GuestRatingSubmitted,
  GuestRatingRetracted,
  GuestFeedbackSubmitted,
  GuestFeedbackRetracted,
  GuestReviewLinkClicked,
  GuestEvent,
} from '../domain/events'
