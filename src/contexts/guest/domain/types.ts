import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
  RatingId,
  FeedbackId,
} from '#/shared/domain/ids'

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
