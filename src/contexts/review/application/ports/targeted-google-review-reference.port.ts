import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export type TargetedGoogleReviewReferenceResolver = Readonly<{
  resolve(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
      referenceRef: string | null
    }>,
  ): Promise<
    | Readonly<{
        status: 'found'
        locationName: string
        reviewName: string
      }>
    | Readonly<{
        status: 'reconcile'
        locationName: string
        reason:
          | 'reference_missing'
          | 'reference_expired'
          | 'reference_unavailable'
          | 'reference_invalid'
      }>
    | Readonly<{ status: 'obsolete' }>
  >
}>
