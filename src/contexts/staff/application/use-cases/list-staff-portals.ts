// Staff context — list staff portals use case
// Extracted from the server fn (D8-008): the fan-out over assigned portals,
// filtering by isActive, and sorting by name now live in a use case,
// testable independently.

import type { StaffPortalLookupPort } from '../ports/portal-lookup.port'
import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { StaffPortalEntry } from '../public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { staffError } from '../../domain/errors'

export type ListStaffPortalsDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  portalLookup: StaffPortalLookupPort
}>

export type ListStaffPortalsInput = Readonly<{
  userId: UserId
  propertyId: PropertyId
}>

export type ListStaffPortalsResult = Readonly<{
  portals: ReadonlyArray<StaffPortalEntry>
}>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type ListStaffPortals = (
  input: ListStaffPortalsInput,
  ctx: AuthContext,
) => Promise<ListStaffPortalsResult>

/**
 * List active portals assigned to a staff member for a given property.
 *
 * Steps:
 * 1. Authorize — staff_assignment.read
 * 2. Resolve assigned portal IDs
 * 3. Fan-out — fetch portal details, keep only active portals
 * 4. Sort alphabetically by name
 */
export const listStaffPortals =
  (deps: ListStaffPortalsDeps): ListStaffPortals =>
  async (input, ctx) => {
    // 1. Authorize
    if (!canForContext(ctx, 'staff_assignment.read')) {
      throw staffError('forbidden', 'No staff assignment read permission')
    }

    // 2. Resolve assigned portal IDs for this staff member
    const assignments = await deps.assignmentRepo.listByUserAndProperty(
      ctx.organizationId,
      input.userId,
      input.propertyId,
    )

    // Extract unique non-null portalIds
    const seen = new Set<PortalId>()
    const portalIds: PortalId[] = []
    for (const a of assignments) {
      if (a.portalId !== null && !seen.has(a.portalId)) {
        seen.add(a.portalId)
        portalIds.push(a.portalId)
      }
    }

    if (portalIds.length === 0) {
      return { portals: [] }
    }

    // 3. Fan-out — fetch portal details, keep only active portals
    const portals: StaffPortalEntry[] = []
    for (const pid of portalIds) {
      const portal = await deps.portalLookup.getPortalInfo(ctx.organizationId, pid)
      if (portal && portal.isActive) {
        portals.push({ id: portal.id, name: portal.name })
      }
    }

    // 4. Sort alphabetically by name
    portals.sort((a, b) => a.name.localeCompare(b.name))

    return { portals }
  }
