// Staff context — portal lookup port
// Cross-context port for resolving portal data. Staff is built before portal
// in the composition root (portal depends on staff.publicApi), so this port
// is injected via a late-binding closure that resolves portal at call time.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

/** Portal data the staff context needs from the portal context. */
export type StaffPortalLookupPort = Readonly<{
  /** Returns portal IDs belonging to a property (ownership validation). */
  listPortalIdsByProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<PortalId>>

  /** Returns minimal portal info for the staff portal listing. */
  getPortalInfo: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<Readonly<{ id: PortalId; name: string; isActive: boolean }> | null>
}>
