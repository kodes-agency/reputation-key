// Property context — build function.
// Wires property repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'

import type { PropertyRepository } from './application/ports/property.repository'
import { createPropertyResponsibilityRuntime } from './application/property-responsibility-runtime'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/application/public-api'
import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createProperty } from './application/use-cases/create-property'
import { updateProperty } from './application/use-cases/update-property'
import { listProperties } from './application/use-cases/list-properties'
import { getProperty } from './application/use-cases/get-property'
import { createAtomicPropertyCommandStore } from './infrastructure/property-command-store'
import { createPropertyGoogleBindingStore } from './infrastructure/property-google-binding-store'
import { createPropertyLifecycleCommandStore } from './infrastructure/property-lifecycle-command-store'
import { registerPropertyRetentionConsumer } from './infrastructure/outbox-consumers'
import { createPropertyOrganizationExportContributor } from './infrastructure/adapters/property-organization-export.adapter'
import { createPropertyOrganizationLifecycleContributor } from './infrastructure/adapters/property-organization-lifecycle.adapter'
import { createPropertyResponsibleManagerRepository } from './infrastructure/repositories/property-responsible-manager.repository'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './application/use-cases/property-responsible-managers'
import { isEligiblePropertyManager } from './application/property-manager-eligibility'
import { propertyId } from '#/shared/domain/ids'
import {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from './application/use-cases/property-lifecycle'

type PropertyContextDeps = Readonly<{
  db: Database
  repo: PropertyRepository
  clock: () => Date
  idGen: () => string
  staffPublicApi: StaffPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  /**
   * BQC-2.7 parity for the manual creation path: grant a newly created
   * property the capability allowlist its organization already holds. Without
   * it a new property denies every non-core capability
   * (`property_not_allowlisted`) until an operator repairs it.
   */
  provisionPropertyCapabilities?: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      createdBy: string
    }>,
  ) => Promise<void>
  logger: Pick<LoggerPort, 'info' | 'warn'>
}>

export const buildPropertyContext = (deps: PropertyContextDeps) => {
  const idGen = () => propertyId(deps.idGen())
  // BQC-3.5: every property state mutation + fact commits atomically here.
  const commandStore = createAtomicPropertyCommandStore(deps.db)
  const bindingApi = createPropertyGoogleBindingStore(deps.db)
  const lifecycleStore = createPropertyLifecycleCommandStore(deps.db)
  const responsibleManagerRepo = createPropertyResponsibleManagerRepository(deps.db)
  const managerEligibility = {
    identityPublicApi: deps.identityManagerFacts,
    staffPublicApi: deps.staffPublicApi,
  }
  const lifecycleReadiness = {
    hasEligibleResponsibleManager: async (
      organizationId: OrganizationId,
      pid: PropertyId,
    ) => {
      const assignments = await responsibleManagerRepo.listActive(organizationId, pid)
      const eligibility = await Promise.all(
        assignments.map((assignment) =>
          isEligiblePropertyManager(
            managerEligibility,
            organizationId,
            pid,
            assignment.userId,
          ),
        ),
      )
      return eligibility.some(Boolean)
    },
  } as const

  const useCases = {
    createProperty: createProperty({
      propertyRepo: deps.repo,
      commandStore,
      idGen,
      clock: deps.clock,
      provisionCapabilities: deps.provisionPropertyCapabilities,
      logger: deps.logger,
    }),
    updateProperty: updateProperty({
      propertyRepo: deps.repo,
      staffPublicApi: deps.staffPublicApi,
      commandStore,
      clock: deps.clock,
    }),
    listProperties: listProperties({
      propertyRepo: deps.repo,
      staffApi: deps.staffPublicApi,
    }),
    getProperty: getProperty({
      propertyRepo: deps.repo,
      staffPublicApi: deps.staffPublicApi,
    }),
    archiveProperty: archiveProperty({
      propertyRepo: deps.repo,
      lifecycleStore,
      staffPublicApi: deps.staffPublicApi,
      clock: deps.clock,
    }),
    restoreProperty: restoreProperty({
      propertyRepo: deps.repo,
      lifecycleStore,
      staffPublicApi: deps.staffPublicApi,
      readiness: lifecycleReadiness,
      clock: deps.clock,
    }),
    disconnectPropertyGoogleBinding: disconnectPropertyGoogleBinding({
      propertyRepo: deps.repo,
      staffPublicApi: deps.staffPublicApi,
      bindingStore: bindingApi,
      clock: deps.clock,
    }),
    listPropertyResponsibleManagers: listPropertyResponsibleManagers({
      propertyRepo: deps.repo,
      managerRepo: responsibleManagerRepo,
      ...managerEligibility,
      clock: deps.clock,
    }),
    updatePropertyResponsibleManagers: updatePropertyResponsibleManagers({
      propertyRepo: deps.repo,
      managerRepo: responsibleManagerRepo,
      ...managerEligibility,
      clock: deps.clock,
    }),
  } as const

  const propertyFactsApi = {
    ...bindingApi,
    propertyExists: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p !== null
    },
    getPropertyName: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p?.name ?? null
    },
    getPropertyReplyLanguage: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p?.defaultReplyLanguage ?? null
    },
    getPropertyTimezone: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p?.timezone ?? null
    },
    getGoogleReviewDestination: async (orgId: OrganizationId, pid: PropertyId) => {
      const property = await deps.repo.findById(orgId, pid)
      return property?.googleReviewDestination ?? null
    },
    isPropertyActive: async (orgId: OrganizationId, pid: PropertyId) => {
      const property = await deps.repo.findById(orgId, pid)
      return property?.lifecycleState === 'active'
    },
    getPropertyNames: async (
      orgId: OrganizationId,
      propertyIds: ReadonlyArray<PropertyId>,
    ) => {
      const properties = await deps.repo.findByIds(orgId, propertyIds)
      return properties.map((p) => ({ id: p.id as string, name: p.name }))
    },
    findByGbpLocationId: async (gbpLocationId: string) => {
      const p = await deps.repo.findByGbpLocationId(gbpLocationId)
      if (!p) return null
      return {
        id: p.id,
        organizationId: p.organizationId,
        googleConnectionId: p.googleConnectionId,
        gbpAccountId: p.gbpAccountId,
        gbpLocationId: p.gbpLocationId,
        googleBindingState: p.googleBindingState,
        sourceEpoch: p.sourceEpoch,
      }
    },
    getSourceEpoch: async (orgId: OrganizationId, pid: PropertyId) => {
      const property = await deps.repo.findById(orgId, pid)
      return property ? { sourceEpoch: property.sourceEpoch } : null
    },
    findIdsByGoogleConnection: async (
      connectionId: GoogleConnectionId,
      orgId: OrganizationId,
    ) => {
      return deps.repo.findIdsByGoogleConnection(connectionId, orgId)
    },
    findGoogleNotificationAnchor: async (
      connectionId: GoogleConnectionId,
      orgId: OrganizationId,
    ) => {
      const linked = [
        ...(await deps.repo.findIdsByGoogleConnection(connectionId, orgId)),
      ].sort()
      if (linked[0]) return linked[0]
      const active = [...(await deps.repo.list(orgId))]
        .map((candidate) => candidate.id as string)
        .sort()
      return active[0] ?? null
    },
    clearGoogleConnectionRef: async (
      orgId: OrganizationId,
      connectionId: GoogleConnectionId,
    ) => {
      const propertyIds = await deps.repo.findIdsByGoogleConnection(connectionId, orgId)
      if (propertyIds.length > 0) {
        await deps.repo.clearGoogleConnectionRef(orgId, propertyIds)
      }
    },
    getResponsibleManagerUserIds: async (orgId: OrganizationId, pid: PropertyId) => {
      const assignments = await responsibleManagerRepo.listActive(orgId, pid)
      const eligible = await Promise.all(
        assignments.map(async (assignment) =>
          (await isEligiblePropertyManager(
            managerEligibility,
            orgId,
            pid,
            assignment.userId,
          ))
            ? assignment.userId
            : null,
        ),
      )
      return eligible.filter(
        (userId): userId is import('#/shared/domain/ids').UserId => userId !== null,
      )
    },
    isEligibleResponsibleManagerUserId: async (
      orgId: OrganizationId,
      pid: PropertyId,
      managerId: UserId,
    ) => {
      if (!(await deps.repo.findById(orgId, pid))) return false
      return isEligiblePropertyManager(managerEligibility, orgId, pid, managerId)
    },
  }

  const publicApi = Object.freeze({
    ...propertyFactsApi,
    management: Object.freeze(useCases),
  })

  return {
    publicApi,
    worker: Object.freeze({
      registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) =>
        registerPropertyRetentionConsumer(consumerRegistry, publicApi),
    }),
    /** ARC-03-T11: the named member-authority capability. Replaces the root's
     * Property responsible-manager repository reach-through. */
    responsibility: createPropertyResponsibilityRuntime(responsibleManagerRepo),
    /** LIF-01: the Property-owned Organization Export contributor. It stays
     * out of `publicApi` on purpose — an export slice is lifecycle
     * composition input, not a product capability any request-facing surface
     * may reach. */
    organizationExportContributor: createPropertyOrganizationExportContributor(deps.db),
    /** LIF-01-T12/T13/T14: the Property-owned Organization lifecycle
     * contributor. Like the export slice it stays out of `publicApi`: the
     * purge phase must remain unreachable by default, and it may only ever be
     * reached through an explicitly reviewed composition of the lifecycle
     * coordinator, never through a request-facing surface. */
    organizationLifecycleContributor: createPropertyOrganizationLifecycleContributor(
      deps.db,
    ),
    internal: {
      repos: { responsibleManagerRepo } as const,
      useCases,
    },
  } as const
}
