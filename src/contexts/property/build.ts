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
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createProperty } from './application/use-cases/create-property'
import { updateProperty } from './application/use-cases/update-property'
import { listProperties } from './application/use-cases/list-properties'
import { getProperty } from './application/use-cases/get-property'
import { requestRegionMove } from './application/use-cases/request-region-move'
import {
  advanceRegionMove,
  type RegionMoveQueueBinding,
} from './application/use-cases/advance-region-move'
import type { RegionMoveAuditWriter } from './application/ports/region-move-request-command-store.port'
import { createAtomicPropertyCommandStore } from './infrastructure/property-command-store'
import { createPropertyGoogleBindingStore } from './infrastructure/property-google-binding-store'
import { createPropertyLifecycleCommandStore } from './infrastructure/property-lifecycle-command-store'
import { registerPropertyRetentionConsumer } from './infrastructure/outbox-consumers'
import { createRegionMoveRepository } from './infrastructure/repositories/region-move.repository'
import { createRegionMoveRequestCommandStore } from './infrastructure/adapters/region-move-request-command-store.adapter'
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
import {
  ACCEPTING_DATA_CELL_IDS,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'

/**
 * BQC-4.5 / ADR 0057 region-move wiring. approvedCells defaults to the catalogue's
 * accepting set; widening therefore requires a reviewed catalogue state
 * transition. queues binds the cell's property-scoped queues for the
 * stepper's pause/drain/resume (BQC-0.4 primitive + BQC-3.7 depth reader).
 */
export type RegionMoveContextDeps = Readonly<{
  writeOperatorAudit: RegionMoveAuditWriter
  queues: ReadonlyArray<RegionMoveQueueBinding>
  approvedCells?: ReadonlySet<string>
}>

type PropertyContextDeps = Readonly<{
  db: Database
  repo: PropertyRepository
  events: EventBus
  clock: () => Date
  idGen: () => string
  /** REG-01: process-local repository/command-store cell fence. */
  localCell: DataCellId
  staffPublicApi: StaffPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  regionMove: RegionMoveContextDeps
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
  const commandStore = createAtomicPropertyCommandStore(
    deps.db,
    deps.events,
    deps.localCell,
  )
  // BQC-4.5: the accepted-request authority co-commits the machine row and
  // operator decision. The transition store then owns guarded authority swaps.
  const regionMoveStore = createRegionMoveRepository(deps.db)
  const regionMoveRequestCommandStore = createRegionMoveRequestCommandStore(deps.db)
  const bindingApi = createPropertyGoogleBindingStore(
    deps.db,
    deps.events,
    deps.localCell,
  )
  const lifecycleStore = createPropertyLifecycleCommandStore(
    deps.db,
    deps.events,
    deps.localCell,
  )
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
      hasActiveRegionMove: async (orgId, pid) =>
        (await regionMoveStore.findActiveMoveForProperty(orgId, pid)) !== null,
    }),
    listProperties: listProperties({
      propertyRepo: deps.repo,
      staffApi: deps.staffPublicApi,
    }),
    getProperty: getProperty({
      propertyRepo: deps.repo,
      staffPublicApi: deps.staffPublicApi,
    }),
    requestRegionMove: requestRegionMove({
      propertyRepo: deps.repo,
      requestCommandStore: regionMoveRequestCommandStore,
      approvedCells: deps.regionMove.approvedCells ?? new Set(ACCEPTING_DATA_CELL_IDS),
      writeOperatorAudit: deps.regionMove.writeOperatorAudit,
      idGen: deps.idGen,
      clock: deps.clock,
    }),
    advanceRegionMove: advanceRegionMove({
      moveStore: regionMoveStore,
      queues: deps.regionMove.queues,
      clock: deps.clock,
      logger: deps.logger,
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
      events: deps.events,
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
    // BQC-4.1: content-free routing fact for fail-closed consumers (review
    // sync asserts an approved cell before any external effect).
    getProcessingRegion: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p?.dataCellId ?? null
    },
    getProcessingScope: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p ? { processingRegion: p.dataCellId, sourceEpoch: p.sourceEpoch } : null
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
