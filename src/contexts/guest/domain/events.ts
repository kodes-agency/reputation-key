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
  PortalAccessArtifactId,
  PortalGroupId,
  QualifiedScanId,
} from '#/shared/domain/ids'
import { assert } from '#/shared/domain/assert'
import type { ScanSource } from './types'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

type GuestEventInput<T> = Omit<T, '_tag' | 'eventId' | 'correlationId'> & {
  correlationId?: string | null
}

export type GuestScanRecorded = Readonly<{
  _tag: 'guest.scan.recorded'
  eventId: string
  scanId: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  scanSource: ScanSource
  occurredAt: Date
  correlationId: string | null
}>

export const guestScanRecorded = (
  args: GuestEventInput<GuestScanRecorded>,
): GuestScanRecorded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.scanId !== '', 'scanId required')
  return {
    _tag: 'guest.scan.recorded',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type GuestQualifiedScanRecorded = Readonly<{
  _tag: 'guest.qualified_scan.recorded'
  eventId: string
  qualifiedScanId: QualifiedScanId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  accessArtifactId: PortalAccessArtifactId
  /** Omitted only by historical v1 replay fixtures. New constructors materialize null. */
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  occurredAt: Date
  correlationId: string | null
}>

export const guestQualifiedScanRecorded = (
  args: GuestEventInput<GuestQualifiedScanRecorded>,
): GuestQualifiedScanRecorded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.qualifiedScanId !== '', 'qualifiedScanId required')
  assert(args.accessArtifactId !== '', 'accessArtifactId required')
  return {
    _tag: 'guest.qualified_scan.recorded',
    eventId: newEventId(),
    ...args,
    staffAttribution: args.staffAttribution ?? null,
    correlationId: args.correlationId ?? null,
  }
}

export type GuestQualifiedScanRetracted = Readonly<{
  _tag: 'guest.qualified_scan.retracted'
  eventId: string
  qualifiedScanId: QualifiedScanId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  accessArtifactId: PortalAccessArtifactId
  supersedesSourceEventId: string
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  occurredAt: Date
  correlationId: string | null
}>

export const guestQualifiedScanRetracted = (
  args: GuestEventInput<GuestQualifiedScanRetracted>,
): GuestQualifiedScanRetracted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.qualifiedScanId !== '', 'qualifiedScanId required')
  assert(args.accessArtifactId !== '', 'accessArtifactId required')
  assert(args.supersedesSourceEventId.trim().length > 0, 'source event id required')
  return {
    _tag: 'guest.qualified_scan.retracted',
    eventId: newEventId(),
    ...args,
    staffAttribution: args.staffAttribution ?? null,
    correlationId: args.correlationId ?? null,
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
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  occurredAt: Date
  correlationId: string | null
}>

export const guestRatingSubmitted = (
  args: GuestEventInput<GuestRatingSubmitted>,
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
    ...args,
    staffAttribution: args.staffAttribution ?? null,
    correlationId: args.correlationId ?? null,
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
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  occurredAt: Date
  correlationId: string | null
}>

export const guestRatingRetracted = (
  args: GuestEventInput<GuestRatingRetracted>,
): GuestRatingRetracted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.ratingId !== '', 'ratingId required')
  assert(args.supersedesSourceEventId.trim().length > 0, 'source event id required')
  return {
    _tag: 'guest.rating.retracted',
    eventId: newEventId(),
    ...args,
    staffAttribution: args.staffAttribution ?? null,
    correlationId: args.correlationId ?? null,
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
  /** Exact Guest Response Revision at private-feedback submission time. */
  responseRevision?: number
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
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
  /** Preserved submission revision; withdrawal never manufactures a new one. */
  responseRevision?: number
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
  occurredAt: Date
  correlationId: string | null
}>

export const guestFeedbackRetracted = (
  args: GuestEventInput<GuestFeedbackRetracted>,
): GuestFeedbackRetracted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.feedbackId !== '', 'feedbackId required')
  assert(args.supersedesSourceEventId.trim().length > 0, 'source event id required')
  const responseRevision = args.responseRevision ?? 1
  assert(Number.isSafeInteger(responseRevision), 'responseRevision must be safe')
  assert(responseRevision > 0, 'responseRevision must be positive')
  return {
    _tag: 'guest.feedback.retracted',
    eventId: newEventId(),
    ...args,
    responseRevision,
    staffAttribution: args.staffAttribution ?? null,
    correlationId: args.correlationId ?? null,
  }
}

export const guestFeedbackSubmitted = (
  args: GuestEventInput<GuestFeedbackSubmitted>,
): GuestFeedbackSubmitted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.feedbackId !== '', 'feedbackId required')
  const responseRevision = args.responseRevision ?? 1
  assert(Number.isSafeInteger(responseRevision), 'responseRevision must be safe')
  assert(responseRevision > 0, 'responseRevision must be positive')
  return {
    _tag: 'guest.feedback.submitted',
    eventId: newEventId(),
    ...args,
    responseRevision,
    staffAttribution: args.staffAttribution ?? null,
    correlationId: args.correlationId ?? null,
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
  args: GuestEventInput<GuestReviewLinkClicked>,
): GuestReviewLinkClicked => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.linkId !== '', 'linkId required')
  return {
    _tag: 'guest.review_link.clicked',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type GuestEvent =
  | GuestScanRecorded
  | GuestQualifiedScanRecorded
  | GuestQualifiedScanRetracted
  | GuestRatingSubmitted
  | GuestRatingRetracted
  | GuestFeedbackSubmitted
  | GuestFeedbackRetracted
  | GuestReviewLinkClicked
