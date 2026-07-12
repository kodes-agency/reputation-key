// Staff context — build function.
// Wires staff repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { StaffAssignmentRepository } from './application/ports/staff-assignment.repository'
import {
  getCachedAccessiblePropertySet,
  setCachedAccessiblePropertySet,
} from '#/shared/auth/middleware'
import { fetchPermissionVersion } from '#/shared/db/role-definitions'
import { getDb } from '#/shared/db'
import { trace } from '#/shared/observability/trace'
import type { StaffPortalLookupPort } from './application/ports/portal-lookup.port'
import type { IdentityMembershipPort } from './application/ports/identity-membership.port'
import type { StaffPublicApi } from './application/public-api'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { createStaffAssignment } from './application/use-cases/create-staff-assignment'
import { removeStaffAssignment } from './application/use-cases/remove-staff-assignment'
import { listStaffAssignments } from './application/use-cases/list-staff-assignments'
import { getAssignedPortals } from './application/use-cases/get-assigned-portals'
import { updateStaffPortals } from './application/use-cases/update-staff-portals'
import { listStaffPortals } from './application/use-cases/list-staff-portals'
import { randomUUID } from 'crypto'

type StaffContextDeps = Readonly<{
  repo: StaffAssignmentRepository
  portalLookup: StaffPortalLookupPort
  events: EventBus
  clock: () => Date
  /**
   * Validates that a target userId is a member of ctx.organizationId before
   * creating a staff assignment (ADR 0006). Wired in the composition root to
   * an adapter backed by the identity context.
   */
  identityMembership: IdentityMembershipPort
}>

export const buildStaffContext = (deps: StaffContextDeps) => {
  const idGen = () => randomUUID()

  const getAssignedPortalsUC = getAssignedPortals({
    assignmentRepo: deps.repo,
  })

  // Build publicApi first so it can be passed to use cases that need
  // property-access scoping (create/update staff assignments).
  const publicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async (
      orgId: OrganizationId,
      userId: UserId,
      orgWide: boolean,
    ) => {
      if (orgWide) return null

      return trace('staff.getAccessiblePropertyIds', async () => {
        // AC-04: version-keyed cache (org:user:version). The version fetch is a cheap PK lookup.
        // When permission_version bumps (including on staff_assignments changes), we naturally use a new key.
        const currentVersion = await fetchPermissionVersion(
          getDb(),
          orgId as unknown as string,
        )
        const cached = getCachedAccessiblePropertySet(
          orgId as unknown as string,
          userId as unknown as string,
          currentVersion,
        )
        if (cached !== undefined) {
          return cached
        }

        const ids = await deps.repo.getAccessiblePropertyIds(orgId, userId)
        setCachedAccessiblePropertySet(
          orgId as unknown as string,
          userId as unknown as string,
          currentVersion,
          ids,
        )
        return ids
      })
    },
    getAssignedPortals: getAssignedPortalsUC,
    countAssignmentsByTeam: async (orgId, teamId) => {
      const assignments = await deps.repo.listByTeam(orgId, teamId)
      return assignments.length
    },
  }

  const useCases = {
    createStaffAssignment: createStaffAssignment({
      assignmentRepo: deps.repo,
      events: deps.events,
      staffPublicApi: publicApi,
      identityMembership: deps.identityMembership,
      idGen,
      clock: deps.clock,
    }),
    removeStaffAssignment: removeStaffAssignment({
      assignmentRepo: deps.repo,
      events: deps.events,
      clock: deps.clock,
    }),
    listStaffAssignments: listStaffAssignments({
      assignmentRepo: deps.repo,
    }),
    getAssignedPortals: getAssignedPortalsUC,
    updateStaffPortals: updateStaffPortals({
      assignmentRepo: deps.repo,
      portalLookup: deps.portalLookup,
      events: deps.events,
      staffPublicApi: publicApi,
      clock: deps.clock,
      idGen,
    }),
    listStaffPortals: listStaffPortals({
      assignmentRepo: deps.repo,
      portalLookup: deps.portalLookup,
    }),
  } as const

  return {
    publicApi,
    internal: {
      repos: { staffAssignmentRepo: deps.repo } as const,
      useCases,
    },
  } as const
}
