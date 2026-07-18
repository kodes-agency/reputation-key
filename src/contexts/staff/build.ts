// Staff context — build function.
// Wires staff repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { Database } from '#/shared/db'
import type { StaffAssignmentRepository } from './application/ports/staff-assignment.repository'
import type { AccessiblePropertyLookupPort } from './application/ports/accessible-property-lookup.port'
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
import { createAtomicStaffCommandStore } from './infrastructure/staff-command-store'
import { randomUUID } from 'crypto'

type StaffContextDeps = Readonly<{
  db: Database
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
  /**
   * BQC-2.3: the ONLY source of property-access scope — the identity-owned
   * PropertyAccessGrant repository (ADR 0039). Staff/team/portal
   * participation is never an authorization input. Wired in the composition
   * root to the grant-backed identity adapter.
   */
  accessiblePropertyLookup: AccessiblePropertyLookupPort
}>

export const buildStaffContext = (deps: StaffContextDeps) => {
  const idGen = () => randomUUID()
  // BQC-3.5: every staff state mutation + fact commits atomically here.
  const commandStore = createAtomicStaffCommandStore(deps.db, deps.events)

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
      // orgWide is role-derived (scopeForPermission === 'organization') and
      // stays a null pass-through. Otherwise the GRANT lookup decides —
      // empty array means no grants, which downstream helpers treat as deny
      // (never organization-wide allow).
      if (orgWide) return null

      return trace('staff.getAccessiblePropertyIds', () =>
        deps.accessiblePropertyLookup(orgId, userId),
      )
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
      commandStore,
      staffPublicApi: publicApi,
      identityMembership: deps.identityMembership,
      idGen,
      clock: deps.clock,
    }),
    removeStaffAssignment: removeStaffAssignment({
      assignmentRepo: deps.repo,
      commandStore,
      clock: deps.clock,
    }),
    listStaffAssignments: listStaffAssignments({
      assignmentRepo: deps.repo,
    }),
    getAssignedPortals: getAssignedPortalsUC,
    updateStaffPortals: updateStaffPortals({
      assignmentRepo: deps.repo,
      portalLookup: deps.portalLookup,
      commandStore,
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
      commandStore,
      useCases,
    },
  } as const
}
