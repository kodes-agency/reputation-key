// Guest context — domain events
// Standards: docs/standards.md §1

import type {
  ScanEventId,
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
} from '#/shared/domain/ids'
import type { ScanSource } from './types'
import { guestError } from './errors'

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
  args: Omit<GuestScanRecorded, '_tag' | 'correlationId'>,
): GuestScanRecorded => {
  if (!(args.occurredAt instanceof Date))
    throw guestError('invalid_source', 'occurredAt must be Date')
  if (args.scanId === '') throw guestError('invalid_source', 'scanId required')
  return {
    _tag: 'guest.scan.recorded',
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
  occurredAt: Date
  correlationId: string | null
}>

export const guestRatingSubmitted = (
  args: Omit<GuestRatingSubmitted, '_tag' | 'correlationId'>,
): GuestRatingSubmitted => {
  if (!(args.occurredAt instanceof Date))
    throw guestError('invalid_rating', 'occurredAt must be Date')
  if (args.ratingId === '') throw guestError('invalid_rating', 'ratingId required')
  return {
    _tag: 'guest.rating.submitted',
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

export const guestFeedbackSubmitted = (
  args: Omit<GuestFeedbackSubmitted, '_tag' | 'correlationId'>,
): GuestFeedbackSubmitted => {
  if (!(args.occurredAt instanceof Date))
    throw guestError('invalid_rating', 'occurredAt must be Date')
  if (args.feedbackId === '') throw guestError('invalid_rating', 'feedbackId required')
  return {
    _tag: 'guest.feedback.submitted',
    correlationId: null,
    ...args,
  }
}

export type GuestReviewLinkClicked = Readonly<{
  _tag: 'guest.review_link.clicked'
  eventId: string
  linkId: PortalLinkId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>

export const guestReviewLinkClicked = (
  args: Omit<GuestReviewLinkClicked, '_tag' | 'correlationId'>,
): GuestReviewLinkClicked => {
  if (!(args.occurredAt instanceof Date))
    throw guestError('invalid_source', 'occurredAt must be Date')
  if (args.linkId === '') throw guestError('invalid_source', 'linkId required')
  return {
    _tag: 'guest.review_link.clicked',
    correlationId: null,
    ...args,
  }
}

export type GuestEvent =
  | GuestScanRecorded
  | GuestRatingSubmitted
  | GuestFeedbackSubmitted
  | GuestReviewLinkClicked
