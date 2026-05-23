import type {
  ScanEventId,
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
  StaffId,
} from '#/shared/domain/ids'

import type { ScanSource } from './types'

export type ScanRecorded = Readonly<{
  _tag: 'scan.recorded'
  scanId: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  staffId: StaffId | null
  occurredAt: Date
}>

export const scanRecorded = (payload: Omit<ScanRecorded, '_tag'>): ScanRecorded => ({
  _tag: 'scan.recorded',
  ...payload,
})

export type RatingSubmitted = Readonly<{
  _tag: 'rating.submitted'
  ratingId: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  value: number
  staffId: StaffId | null
  occurredAt: Date
}>

export const ratingSubmitted = (
  payload: Omit<RatingSubmitted, '_tag'>,
): RatingSubmitted => ({
  _tag: 'rating.submitted',
  ...payload,
})

export type FeedbackSubmitted = Readonly<{
  _tag: 'feedback.submitted'
  feedbackId: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  ratingId: RatingId | null
  staffId: StaffId | null
  occurredAt: Date
}>

export const feedbackSubmitted = (
  payload: Omit<FeedbackSubmitted, '_tag'>,
): FeedbackSubmitted => ({
  _tag: 'feedback.submitted',
  ...payload,
})

export type ReviewLinkClicked = Readonly<{
  _tag: 'review-link.clicked'
  linkId: PortalLinkId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  staffId: StaffId | null
  occurredAt: Date
}>

export const reviewLinkClicked = (
  payload: Omit<ReviewLinkClicked, '_tag'>,
): ReviewLinkClicked => ({
  _tag: 'review-link.clicked',
  ...payload,
})

export type GuestEvent =
  | ScanRecorded
  | RatingSubmitted
  | FeedbackSubmitted
  | ReviewLinkClicked
