import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type CurrentOnGoogleReputationSnapshot = Readonly<{
  semantics: 'current_on_google'
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewCount: number
  averageRating: number | null
  /**
   * When Google's numbers were read: a completed snapshot freezes them when it
   * starts, a head check reads them just before it stores them. The Goals
   * 24-hour freshness rule and the headline age are measured from it.
   */
  verifiedAt: Date
}>

export type VerifiedGoogleReputationSnapshotFact = Readonly<{
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  runId: string
  reviewCount: number
  averageRating: number | null
  evaluatedAt: Date
}>

export type CurrentGoogleReputationSnapshotStore = Readonly<{
  applyVerifiedSnapshot(
    input: VerifiedGoogleReputationSnapshotFact,
  ): Promise<'applied' | 'duplicate' | 'obsolete'>
  getCurrentOnGoogle(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<CurrentOnGoogleReputationSnapshot | null>
}>
