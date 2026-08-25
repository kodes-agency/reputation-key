// Staff context — build function.
// Wires staff repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.
//
// Legacy StaffAssignment persistence remains exposed only for quarantined Team
// reconciliation. No legacy assignment use case or network endpoint is built.

import type { Database } from '#/shared/db'
import type { StaffAssignmentRepository } from './application/ports/staff-assignment.repository'
import type { AccessiblePropertyLookupPort } from './application/ports/accessible-property-lookup.port'
import { trace } from '#/shared/observability/trace'
import type { StaffPortalLookupPort } from './application/ports/portal-lookup.port'
import type { IdentityMembershipPort } from './application/ports/identity-membership.port'
import type { StaffPublicApi } from './application/public-api'
import {
  portalId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { listStaffPortals } from './application/use-cases/list-staff-portals'
import { createStaffParticipationRepository } from './infrastructure/repositories/staff-participation.repository'
import {
  archiveStaffParticipation,
  createStaffParticipation,
  listStaffParticipations,
  updatePortalResponsibilities,
} from './application/use-cases/staff-participations'
import { createParticipation } from './domain/staff-participation'
import { randomUUID } from 'crypto'

type StaffContextDeps = Readonly<{
  db: Database
  repo: StaffAssignmentRepository
  portalLookup: StaffPortalLookupPort
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
  const participationRepo = createStaffParticipationRepository(deps.db)

  const responsibilityLookup = {
    listAssignedPortalIds: async (
      organizationId: OrganizationId,
      userId: UserId,
      propertyId: PropertyId,
    ) => {
      const participation = await participationRepo.findActiveByUser(
        organizationId,
        propertyId,
        userId,
      )
      if (!participation) return []
      const responsibilities = await participationRepo.listActiveResponsibilities(
        organizationId,
        participation.id,
      )
      return responsibilities.map((responsibility) => portalId(responsibility.portalId))
    },
  } as const

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
    getAssignedPortals: async (input, ctx) => {
      return responsibilityLookup.listAssignedPortalIds(
        ctx.organizationId,
        input.userId,
        input.propertyId,
      )
    },
    countAssignmentsByTeam: async (orgId, teamId) => {
      const assignments = await deps.repo.listByTeam(orgId, teamId)
      return assignments.length
    },
    findParticipationById: (organizationId, staffParticipationId) =>
      participationRepo.findById(organizationId, staffParticipationId),
    findActiveParticipation: (organizationId, propertyId, userId) =>
      participationRepo.findActiveByUser(organizationId, propertyId, userId),
    listActiveParticipations: (organizationId, propertyId) =>
      participationRepo.list(organizationId, { propertyId, activeOnly: true }),
  }

  const useCases = {
    listStaffPortals: listStaffPortals({
      responsibilityLookup,
      portalLookup: deps.portalLookup,
    }),
    createStaffParticipation: createStaffParticipation({
      repo: participationRepo,
      identityMembership: deps.identityMembership,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
    listStaffParticipations: listStaffParticipations({
      repo: participationRepo,
      identityMembership: deps.identityMembership,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
    archiveStaffParticipation: archiveStaffParticipation({
      repo: participationRepo,
      identityMembership: deps.identityMembership,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
    updatePortalResponsibilities: updatePortalResponsibilities({
      repo: participationRepo,
      identityMembership: deps.identityMembership,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
  } as const

  const systemStaffParticipation = async (
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      displayName?: string
    }>,
  ) =>
    participationRepo.create(
      createParticipation({
        id: idGen(),
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        userId: input.userId,
        displayName: input.displayName?.trim() || input.userId,
        createdBy: `invitation:${input.userId}`,
        now: deps.clock(),
      }),
    )

  return {
    publicApi,
    internal: {
      repos: {
        staffAssignmentRepo: deps.repo,
        staffParticipationRepo: participationRepo,
      } as const,
      useCases,
      systemStaffParticipation,
    },
  } as const
}
