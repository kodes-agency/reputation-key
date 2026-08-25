import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PortalResponseIntegritySummary } from '../../domain/types'

/** Guest-owned, content-free classification read used by Portal analytics. */
export type PortalResponseIntegrityPort = Readonly<{
  getPortalResponseIntegritySummary(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    startAt: Date
    endAt: Date
  }): Promise<PortalResponseIntegritySummary>
}>
