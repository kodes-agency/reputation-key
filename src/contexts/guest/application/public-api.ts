// Guest context — public API surface for cross-context consumers.
// Other contexts (metric, inbox) and shared infrastructure consume
// event types from this barrel. Per ADR-0001.

export type { ScanEvent, Rating, Feedback, ScanSource } from '../domain/types'

import type { FeedbackId, OrganizationId, PortalId } from '#/shared/domain/ids'
import type { GetPortalResponseIntegritySummary } from './use-cases/get-portal-response-integrity-summary'
export type { PortalResponseIntegritySummary } from './ports/guest-response.repository'

/** Content-free source attribution for cross-context workflow routing. */
export type GuestFeedbackAttributionPublicApi = Readonly<{
  findPortalIdForFeedback: (
    organizationId: OrganizationId,
    feedbackId: FeedbackId,
  ) => Promise<PortalId | null>
}>

export type GuestResponseIntegrityPublicApi = Readonly<{
  getPortalResponseIntegritySummary: GetPortalResponseIntegritySummary
}>

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
