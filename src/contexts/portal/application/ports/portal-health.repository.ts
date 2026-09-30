import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PortalHealth, PortalHealthInterval } from '../../domain/portal-health'

export type PortalHealthRepository = Readonly<{
  transition: (
    input: Readonly<{
      id: string
      organizationId: OrganizationId
      propertyId: PropertyId
      portalId: PortalId
      health: PortalHealth
      sourceVersion: string
      effectiveAt: Date
      observedAt: Date
    }>,
  ) => Promise<PortalHealthInterval>
  getCurrent: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<PortalHealthInterval | null>
  /**
   * `getCurrent` for a set of Portals in one read. A Portal with no interval
   * yet is absent.
   */
  listCurrentForPortals: (
    organizationId: OrganizationId,
    portalIds: readonly PortalId[],
  ) => Promise<readonly PortalHealthInterval[]>
  listHistory: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    limit: number,
  ) => Promise<readonly PortalHealthInterval[]>
}>
