// Staff context — public API surface for cross-context consumers.
// Other contexts (property, team) consume this typed interface
// to query staff assignment data. Per ADR-0001.

import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'

export type StaffPublicApi = Readonly<{
  /**
   * Get property IDs accessible to a user based on their role and assignments.
   * Returns null for AccountAdmin (meaning "all properties in org").
   * Returns specific IDs for PropertyManager/Staff (from staff_assignments).
   */
  getAccessiblePropertyIds: (
    orgId: OrganizationId,
    userId: UserId,
    role: Role,
  ) => Promise<ReadonlyArray<PropertyId> | null>

  /**
   * Get portal IDs assigned to a staff user for a given property.
   * Returns empty array if no portal-level assignments exist.
   */
  getAssignedPortals: (
    input: { userId: UserId; propertyId: PropertyId },
    ctx: AuthContext,
  ) => Promise<ReadonlyArray<PortalId>>
}>

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { StaffUnassigned, StaffAssigned, StaffEvent } from '../domain/events'
export { staffUnassigned, staffAssigned } from '../domain/events'

// ── Error type re-exports (server functions must import from public-api, not domain/errors) ──
export type { StaffErrorCode, StaffError } from '../domain/errors'
export { isStaffError } from '../domain/errors'

// ── Staff type aliases for cross-context consumers ──────────────────────
export type StaffPortalEntry = Readonly<{
  id: PortalId
  name: string
}>
