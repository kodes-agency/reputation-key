import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

/** Guest-owned narrow port; Staff supplies the implementation at composition. */
export type PrimaryStaffAttributionResolver = (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    observedAt: Date
  }>,
) => Promise<PrimaryStaffAttributionSnapshot | null>
