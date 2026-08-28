import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
  RatingId,
  FeedbackId,
  PortalLinkId,
  PortalAccessArtifactId,
  PortalGroupId,
  QualifiedScanId,
} from '#/shared/domain/ids'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

export type ScanSource = 'qr' | 'nfc' | 'direct'

export type ScanEvent = Readonly<{
  id: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  sessionId: string | null
  ipHash: string | null
  createdAt: Date
}>

export type QualifiedScan = Readonly<{
  id: QualifiedScanId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  portalGroupId: PortalGroupId | null
  accessArtifactId: PortalAccessArtifactId
  sourceEventId: string
  occurredAt: Date
  staffAttribution: PrimaryStaffAttributionSnapshot | null
}>

/**
 * Short-lived session-bound receipt input for one qualified destination
 * action. It contains no URL, feedback, contact, or network identifier.
 */
export type GuestDestinationAction = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  destinationId: PortalLinkId
  destinationKind: 'google_review' | 'secondary_link'
  occurredAt: Date
  expiresAt: Date
}>

export type Rating = Readonly<{
  id: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string | null
  value: number
  source: ScanSource
  ipHash: string | null
  createdAt: Date
}>

export type Feedback = Readonly<{
  id: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string | null
  ratingId: RatingId | null
  comment: string
  source: ScanSource
  ipHash: string | null
  createdAt: Date
}>
