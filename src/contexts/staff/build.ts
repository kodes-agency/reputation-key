// Staff context — build function.
// Wires staff repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { Database } from '#/shared/db'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { AccessiblePropertyLookupPort } from './application/ports/accessible-property-lookup.port'
import { trace } from '#/shared/observability/trace'
import {
  portalId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { createStaffParticipationRepository } from './infrastructure/repositories/staff-participation.repository'
import {
  archiveStaffParticipation,
  createStaffParticipation,
  listStaffParticipations,
  updatePortalResponsibilities,
} from './application/use-cases/staff-participations'
import {
  decideCurrentUserParticipationAuthority,
  type CurrentUserParticipationAuthorityDatabase,
} from './infrastructure/repositories/current-user-participation-authority'
import { createPrimaryStaffAttributionResolver } from './infrastructure/primary-staff-attribution'

type StaffContextDeps = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => string
  /**
   * BQC-2.3: the ONLY source of property-access scope — the identity-owned
   * PropertyAccessGrant repository (ADR 0039). Staff participation and Portal
   * responsibility are never authorization inputs. Wired in the composition
   * root to the grant-backed identity adapter.
   */
  accessiblePropertyLookup: AccessiblePropertyLookupPort
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

export const buildStaffContext = (deps: StaffContextDeps) => {
  const idGen = deps.idGen
  const participationRepo = createStaffParticipationRepository(deps.db)
  const resolvePrimaryStaffAttribution = createPrimaryStaffAttributionResolver(deps.db)

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

  const staffFactsApi = {
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
    getAssignedPortals: async (
      input: Readonly<{ userId: UserId; propertyId: PropertyId }>,
      ctx: AuthContext,
    ) => {
      return responsibilityLookup.listAssignedPortalIds(
        ctx.organizationId,
        input.userId,
        input.propertyId,
      )
    },
    resolvePrimaryStaffAttribution,
    findParticipationById: (
      organizationId: OrganizationId,
      staffParticipationId: string,
    ) => participationRepo.findById(organizationId, staffParticipationId),
    findActiveParticipation: (
      organizationId: OrganizationId,
      propertyId: PropertyId,
      userId: UserId,
    ) => participationRepo.findActiveByUser(organizationId, propertyId, userId),
    listActiveParticipations: (organizationId: OrganizationId, propertyId: PropertyId) =>
      participationRepo.list(organizationId, { propertyId, activeOnly: true }),
  }

  const useCases = {
    createStaffParticipation: createStaffParticipation({
      repo: participationRepo,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
    listStaffParticipations: listStaffParticipations({
      repo: participationRepo,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
    archiveStaffParticipation: archiveStaffParticipation({
      repo: participationRepo,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
      reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
    }),
    updatePortalResponsibilities: updatePortalResponsibilities({
      repo: participationRepo,
      accessibleProperties: deps.accessiblePropertyLookup,
      clock: deps.clock,
      idGen,
    }),
  } as const

  const publicApi = Object.freeze({
    ...staffFactsApi,
    management: Object.freeze(useCases),
  })

  const decideUserParticipationAuthority = (
    tx: CurrentUserParticipationAuthorityDatabase,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) => decideCurrentUserParticipationAuthority(tx, input)

  return {
    publicApi,
    // ARC-03-T12: the named authority decision the Inbox command authority
    // consumes. Replaces the root's context-private hatch read.
    authority: Object.freeze({ decideUserParticipationAuthority }),
    internal: {
      repos: {
        staffParticipationRepo: participationRepo,
      } as const,
      useCases,
    },
  } as const
}
