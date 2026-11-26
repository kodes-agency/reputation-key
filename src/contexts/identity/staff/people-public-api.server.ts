// Identity People surface for Staff Participation and Portal attribution facts.
// Property access is delegated to Identity's grant authority and is never
// widened by participation or responsibility records.

import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

export type StaffPublicApi = Readonly<{
  /**
   * Resolve authorization scope from identity-owned PropertyAccessGrant.
   * Participation, membership, and responsibility never widen this set.
   */
  getAccessiblePropertyIds: (
    orgId: OrganizationId,
    userId: UserId,
    orgWide: boolean,
  ) => Promise<ReadonlyArray<PropertyId> | null>
  getAssignedPortals: (
    input: { userId: UserId; propertyId: PropertyId },
    ctx: AuthContext,
  ) => Promise<ReadonlyArray<PortalId>>
}>
