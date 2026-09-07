import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type CurrentOnGoogleReputationSnapshot = Readonly<{
  semantics: 'current_on_google'
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewCount: number
  averageRating: number | null
  /** Time at which Review completed its double-scan verification. */
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
