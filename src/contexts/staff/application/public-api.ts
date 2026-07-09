// Staff context — public API surface for cross-context consumers.
// Other contexts (property, team) consume this typed interface
// to query staff assignment data. Per ADR-0001.

import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

export type StaffPublicApi = Readonly<{
  /**
   * Get property IDs accessible to a user for a permission's scope.
   * `orgWide=true` → null (all properties in the org). `orgWide=false` → the user's
   * assigned-property set (from staff_assignments). The orgWide flag is resolved by
   * the caller via scopeForPermission(ctx, permission) — this method never inspects
   * the role, so custom/multi roles resolve correctly (ADR 0001).
   */
  getAccessiblePropertyIds: (
    orgId: OrganizationId,
    userId: UserId,
    orgWide: boolean,
  ) => Promise<ReadonlyArray<PropertyId> | null>

  /**
   * Get portal IDs assigned to a staff user for a given property.
   * Returns empty array if no portal-level assignments exist.
   */
  getAssignedPortals: (
    input: { userId: UserId; propertyId: PropertyId },
    ctx: AuthContext,
  ) => Promise<ReadonlyArray<PortalId>>

  /**
   * Count active staff assignments for a given team.
   * Used by team context to prevent deleting teams with active assignments.
   */
  countAssignmentsByTeam: (
    orgId: OrganizationId,
    teamId: import('#/shared/domain/ids').TeamId,
  ) => Promise<number>
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
