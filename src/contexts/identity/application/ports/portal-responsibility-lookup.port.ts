import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'

/** Current Staff attribution lookup; it never grants Property access. */
export type PortalResponsibilityLookupPort = Readonly<{
  listAssignedPortalIds: (
    organizationId: OrganizationId,
    userId: UserId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<PortalId>>
}>
