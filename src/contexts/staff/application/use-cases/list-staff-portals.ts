// Staff context — list staff portals use case
// Extracted from the server fn (D8-008): the fan-out over assigned portals,
// filtering by isActive, and sorting by name now live in a use case,
// testable independently.

import type { StaffPortalLookupPort } from '../ports/portal-lookup.port'
import type { PortalResponsibilityLookupPort } from '../ports/portal-responsibility-lookup.port'
import type { StaffPortalEntry } from '../public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { staffError } from '../../domain/errors'

export type ListStaffPortalsDeps = Readonly<{
  responsibilityLookup: PortalResponsibilityLookupPort
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
 * 1. Authorize — staff.read
 * 2. Resolve assigned portal IDs
 * 3. Fan-out — fetch portal details, keep only active portals
 * 4. Sort alphabetically by name
 */
export const listStaffPortals =
  (deps: ListStaffPortalsDeps): ListStaffPortals =>
  async (input, ctx) => {
    // 1. Authorize
    if (!canForContext(ctx, 'staff.read')) {
      throw staffError('forbidden', 'Staff portal read is not permitted')
    }

    // 2. Resolve assigned portal IDs from current Portal responsibilities.
    const assignedPortalIds = await deps.responsibilityLookup.listAssignedPortalIds(
      ctx.organizationId,
      input.userId,
      input.propertyId,
    )

    // Defensive dedupe keeps the public result stable if the lookup returns
    // duplicate responsibility rows.
    const seen = new Set<PortalId>()
    const portalIds: PortalId[] = []
    for (const assignedPortalId of assignedPortalIds) {
      if (!seen.has(assignedPortalId)) {
        seen.add(assignedPortalId)
        portalIds.push(assignedPortalId)
      }
    }

    if (portalIds.length === 0) {
      return { portals: [] }
    }

    // 3. Fan-out — fetch portal details, keep only active portals
    const portals: StaffPortalEntry[] = []
    for (const pid of portalIds) {
      const portal = await deps.portalLookup.getPortalInfo(ctx.organizationId, pid)
      if (portal?.publicationState === 'published') {
        portals.push({ id: portal.id, name: portal.name })
      }
    }

    // 4. Sort alphabetically by name
    portals.sort((a, b) => a.name.localeCompare(b.name))

    return { portals }
  }
