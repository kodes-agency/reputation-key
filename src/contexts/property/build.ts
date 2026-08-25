// Property context — build function.
// Wires property repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { Database } from '#/shared/db'

import type { PropertyRepository } from './application/ports/property.repository'
import type {
  PropertyFactsPublicApi,
  PropertyProcessingScopePublicApi,
  PropertyPublicApi,
  PropertyResponsibleManagerPublicApi,
  PropertyReplyLanguagePublicApi,
} from './application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { IdentityPublicApi } from '#/contexts/identity/application/public-api'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { createProperty } from './application/use-cases/create-property'
import { updateProperty } from './application/use-cases/update-property'
import { listProperties } from './application/use-cases/list-properties'
import { getProperty } from './application/use-cases/get-property'
import { deleteProperty } from './application/use-cases/soft-delete-property'
import { requestRegionMove } from './application/use-cases/request-region-move'
import {
  advanceRegionMove,
  type RegionMoveQueueBinding,
} from './application/use-cases/advance-region-move'
import type { RegionMoveAuditWriter } from './application/ports/region-move-store.port'
import { createAtomicPropertyCommandStore } from './infrastructure/property-command-store'
import { createPropertyGoogleBindingStore } from './infrastructure/property-google-binding-store'
import type { PropertyGoogleBindingPublicApi } from './application/public-api'
import { registerPropertyRetentionConsumer } from './infrastructure/outbox-consumers'
import { createRegionMoveRepository } from './infrastructure/repositories/region-move.repository'
import { createPropertyResponsibleManagerRepository } from './infrastructure/repositories/property-responsible-manager.repository'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './application/use-cases/property-responsible-managers'
import { isEligiblePropertyManager } from './application/property-manager-eligibility'
import { propertyId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import {
  ACCEPTING_DATA_CELL_IDS,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'

/**
 * BQC-4.5 region-move wiring. approvedCells defaults to the catalogue's
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
  /** REG-01: process-local repository/command-store cell fence. */
  localCell: DataCellId
  staffPublicApi: StaffPublicApi
  identityPublicApi: IdentityPublicApi
  regionMove: RegionMoveContextDeps
  /** BQC-1.7: bounded lifecycle purge before the FK-cascading hard delete.
   * Constructed once by the composition root (the only layer that may
   * import review infrastructure) and shared across contexts. */
  sourceContentPurge: SourceContentPurge
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
  logger?: Readonly<{ warn: (obj: object, msg: string) => void }>
  googleImportLifecycle?: Readonly<{
    prepareDeletion: (
      organizationId: string,
      propertyId: string,
    ) => Promise<Readonly<{ itemIds: ReadonlyArray<string> }>>
    finalizeDeletion: (
      organizationId: string,
      itemIds: ReadonlyArray<string>,
    ) => Promise<void>
  }>
}>

export const buildPropertyContext = (deps: PropertyContextDeps) => {
  const idGen = () => propertyId(randomUUID())
  // BQC-3.5: every property state mutation + fact commits atomically here.
  const commandStore = createAtomicPropertyCommandStore(
    deps.db,
    deps.events,
    deps.localCell,
  )
  // BQC-4.5: the region move store (region_moves, migration 0016) + the
  // guarded authority swap on properties.
  const regionMoveStore = createRegionMoveRepository(deps.db)
  const bindingApi: PropertyGoogleBindingPublicApi = createPropertyGoogleBindingStore(
    deps.db,
    deps.events,
    deps.localCell,
  )
  const responsibleManagerRepo = createPropertyResponsibleManagerRepository(deps.db)
  const managerEligibility = {
    identityPublicApi: deps.identityPublicApi,
    staffPublicApi: deps.staffPublicApi,
  }

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
      moveStore: regionMoveStore,
      approvedCells: deps.regionMove.approvedCells ?? new Set(ACCEPTING_DATA_CELL_IDS),
      writeOperatorAudit: deps.regionMove.writeOperatorAudit,
      idGen: () => randomUUID(),
      clock: deps.clock,
    }),
    advanceRegionMove: advanceRegionMove({
      moveStore: regionMoveStore,
      queues: deps.regionMove.queues,
      clock: deps.clock,
    }),
    softDeleteProperty: deleteProperty({
      propertyRepo: deps.repo,
      commandStore,
      clock: deps.clock,
      sourceContentPurge: deps.sourceContentPurge,
      prepareGoogleImportDeletion: deps.googleImportLifecycle?.prepareDeletion,
      finalizeGoogleImportDeletion: deps.googleImportLifecycle?.finalizeDeletion,
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

  const publicApi: PropertyPublicApi &
    PropertyFactsPublicApi &
    PropertyProcessingScopePublicApi &
    PropertyReplyLanguagePublicApi &
    PropertyResponsibleManagerPublicApi = {
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
      }
    },
    findBySlug: async (slug: string) => {
      const p = await deps.repo.findBySlug(slug)
      if (!p) return null
      return {
        id: p.id,
        organizationId: p.organizationId,
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
  }

  return {
    publicApi,
    bindingApi,
    internal: {
      repos: { responsibleManagerRepo } as const,
      useCases,
      registerOutboxConsumers: () => registerPropertyRetentionConsumer(bindingApi),
    },
  } as const
}
