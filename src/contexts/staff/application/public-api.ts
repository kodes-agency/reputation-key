// Staff context — public API surface for cross-context consumers.
// Other contexts consume authoritative StaffParticipation and
// PortalResponsibility lookups through this boundary.

import type {
  OrganizationId,
  PortalId,
  PropertyId,
  TeamId,
  UserId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffParticipation } from '../domain/staff-participation'

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
  countAssignmentsByTeam: (orgId: OrganizationId, teamId: TeamId) => Promise<number>
  findParticipationById?: (
    organizationId: OrganizationId,
    staffParticipationId: string,
  ) => Promise<StaffParticipation | null>
  findActiveParticipation?: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    userId: UserId,
  ) => Promise<StaffParticipation | null>
  listActiveParticipations?: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<readonly StaffParticipation[]>
}>

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { StaffUnassigned, StaffAssigned, StaffEvent } from '../domain/events'
export { staffUnassigned, staffAssigned } from '../domain/events'

// ── Error type re-exports (server functions must import from public-api, not domain/errors) ──
export type { StaffErrorCode, StaffError } from '../domain/errors'
export { isStaffError } from '../domain/errors'
export type { StaffParticipation } from '../domain/staff-participation'
export type { PortalResponsibility } from '../domain/portal-responsibility'

// ── Staff type aliases for cross-context consumers ──────────────────────
export type StaffPortalEntry = Readonly<{
  id: PortalId
  name: string
}>
