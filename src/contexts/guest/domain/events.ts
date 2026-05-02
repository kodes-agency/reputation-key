import type {
  ScanEventId,
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { ScanSource } from './types'

export type ScanRecorded = Readonly<{
  type: 'scan.recorded'
  scanId: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  occurredAt: Date
}>

export const scanRecorded = (payload: Omit<ScanRecorded, 'type'>): ScanRecorded => ({
  type: 'scan.recorded',
  ...payload,
})

export type RatingSubmitted = Readonly<{
  type: 'rating.submitted'
  ratingId: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  value: number
  occurredAt: Date
}>

export const ratingSubmitted = (
  payload: Omit<RatingSubmitted, 'type'>,
): RatingSubmitted => ({
  type: 'rating.submitted',
  ...payload,
})

export type FeedbackSubmitted = Readonly<{
  type: 'feedback.submitted'
  feedbackId: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  ratingId: RatingId | null
  occurredAt: Date
}>

export const feedbackSubmitted = (
  payload: Omit<FeedbackSubmitted, 'type'>,
): FeedbackSubmitted => ({
  type: 'feedback.submitted',
  ...payload,
})

export type ReviewLinkClicked = Readonly<{
  type: 'review-link.clicked'
  linkId: string
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  occurredAt: Date
}>

export const reviewLinkClicked = (
  payload: Omit<ReviewLinkClicked, 'type'>,
): ReviewLinkClicked => ({
  type: 'review-link.clicked',
  ...payload,
})

export type GuestEvent =
  | ScanRecorded
  | RatingSubmitted
  | FeedbackSubmitted
  | ReviewLinkClicked
