// Guest context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import type {
  ScanEventId,
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
} from '#/shared/domain/ids'
import { assert } from '#/shared/domain/assert'
import type { ScanSource } from './types'

export type GuestScanRecorded = Readonly<{
  _tag: 'guest.scan.recorded'
  eventId: string
  scanId: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  occurredAt: Date
  correlationId: string | null
}>

export const guestScanRecorded = (
  args: Omit<GuestScanRecorded, '_tag' | 'eventId' | 'correlationId'>,
): GuestScanRecorded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.scanId !== '', 'scanId required')
  return {
    _tag: 'guest.scan.recorded',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type GuestRatingSubmitted = Readonly<{
  _tag: 'guest.rating.submitted'
  eventId: string
  ratingId: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  value: number
  /** Present on the single bounded correction; Metric replaces this source fact. */
  supersedesSourceEventId?: string | null
  occurredAt: Date
  correlationId: string | null
}>

export const guestRatingSubmitted = (
  args: Omit<GuestRatingSubmitted, '_tag' | 'eventId' | 'correlationId'>,
): GuestRatingSubmitted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.ratingId !== '', 'ratingId required')
  assert(
    args.supersedesSourceEventId === undefined ||
      args.supersedesSourceEventId === null ||
      args.supersedesSourceEventId.trim().length > 0,
    'supersedesSourceEventId must not be empty',
  )
  return {
    _tag: 'guest.rating.submitted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type GuestRatingRetracted = Readonly<{
  _tag: 'guest.rating.retracted'
  eventId: string
  ratingId: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  supersedesSourceEventId: string
  occurredAt: Date
  correlationId: string | null
}>

export const guestRatingRetracted = (
  args: Omit<GuestRatingRetracted, '_tag' | 'eventId' | 'correlationId'>,
): GuestRatingRetracted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.ratingId !== '', 'ratingId required')
  assert(args.supersedesSourceEventId.trim().length > 0, 'source event id required')
  return {
    _tag: 'guest.rating.retracted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type GuestFeedbackSubmitted = Readonly<{
  _tag: 'guest.feedback.submitted'
  eventId: string
  feedbackId: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  ratingId: RatingId | null
  occurredAt: Date
  correlationId: string | null
}>

export type GuestFeedbackRetracted = Readonly<{
  _tag: 'guest.feedback.retracted'
  eventId: string
  feedbackId: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  supersedesSourceEventId: string
  occurredAt: Date
  correlationId: string | null
}>

export const guestFeedbackRetracted = (
  args: Omit<GuestFeedbackRetracted, '_tag' | 'eventId' | 'correlationId'>,
): GuestFeedbackRetracted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.feedbackId !== '', 'feedbackId required')
  assert(args.supersedesSourceEventId.trim().length > 0, 'source event id required')
  return {
    _tag: 'guest.feedback.retracted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const guestFeedbackSubmitted = (
  args: Omit<GuestFeedbackSubmitted, '_tag' | 'eventId' | 'correlationId'>,
): GuestFeedbackSubmitted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.feedbackId !== '', 'feedbackId required')
  return {
    _tag: 'guest.feedback.submitted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type GuestReviewLinkClicked = Readonly<{
  _tag: 'guest.review_link.clicked'
  eventId: string
  linkId: PortalLinkId
  destinationKind: 'google_review' | 'secondary_link'
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>

export const guestReviewLinkClicked = (
  args: Omit<GuestReviewLinkClicked, '_tag' | 'eventId' | 'correlationId'>,
): GuestReviewLinkClicked => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.linkId !== '', 'linkId required')
  return {
    _tag: 'guest.review_link.clicked',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type GuestEvent =
  | GuestScanRecorded
  | GuestRatingSubmitted
  | GuestRatingRetracted
  | GuestFeedbackSubmitted
  | GuestFeedbackRetracted
  | GuestReviewLinkClicked
