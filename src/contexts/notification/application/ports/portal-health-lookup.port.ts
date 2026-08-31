import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type {
  PortalHealthReason,
  PortalHealthStatus,
} from '../portal-health-notification'

export type PortalHealthNotificationFacts = Readonly<{
  propertyId: PropertyId
  status: PortalHealthStatus
  reason: PortalHealthReason
  sourceVersion: string
}>

/** Identifier/enum-only exact-state lookup owned by Portal's public API. */
export type PortalHealthLookupPort = Readonly<{
  findPortalHealthNotificationFacts(
    organizationId: OrganizationId,
    portalId: PortalId,
  ): Promise<PortalHealthNotificationFacts | null>
}>
