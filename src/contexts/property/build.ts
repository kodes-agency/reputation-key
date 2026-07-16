// Property context — build function.
// Wires property repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { PropertyRepository } from './application/ports/property.repository'
import type { PropertyPublicApi } from './application/public-api'
import { propertyImportConflict } from './application/public-api'
import { propertyCreated } from './domain/events'
import { DEFAULT_PROPERTY_ROUTING, type Property } from './domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { createProperty } from './application/use-cases/create-property'
import { updateProperty } from './application/use-cases/update-property'
import { listProperties } from './application/use-cases/list-properties'
import { getProperty } from './application/use-cases/get-property'
import { deleteProperty } from './application/use-cases/soft-delete-property'
import { propertyId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import { emitAndRecord } from '#/shared/outbox/emit-and-record'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'

type PropertyContextDeps = Readonly<{
  repo: PropertyRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
  outboxRepo?: OutboxRepository
}>

export const buildPropertyContext = (deps: PropertyContextDeps) => {
  const idGen = () => propertyId(randomUUID())

  const useCases = {
    createProperty: createProperty({
      propertyRepo: deps.repo,
      events: deps.events,
      idGen,
      clock: deps.clock,
    }),
    updateProperty: updateProperty({
      propertyRepo: deps.repo,
      staffPublicApi: deps.staffPublicApi,
      events: deps.events,
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
    softDeleteProperty: deleteProperty({
      propertyRepo: deps.repo,
      events: deps.events,
      clock: deps.clock,
    }),
  } as const

  const publicApi: PropertyPublicApi = {
    propertyExists: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p !== null
    },
    getPropertyName: async (orgId: OrganizationId, pid: PropertyId) => {
      const p = await deps.repo.findById(orgId, pid)
      return p?.name ?? null
    },
    getPropertyNames: async (
      orgId: OrganizationId,
      propertyIds: ReadonlyArray<PropertyId>,
    ) => {
      const properties = await deps.repo.findByIds(orgId, propertyIds)
      return properties.map((p) => ({ id: p.id as string, name: p.name }))
    },
    findByGbpPlaceId: async (gbpPlaceId: string) => {
      const p = await deps.repo.findByGbpPlaceId(gbpPlaceId)
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
    // F060 NOTE: importProperty intentionally bypasses buildProperty use case.
    // GBP sync requires raw property construction because imported properties
    // have different validation rules (no user-facing slug collision check, etc.).
    // The repo's insertAndReturn still enforces tenant guard (orgId mismatch check).
    importProperty: async (input) => {
      try {
        const id = idGen()
        const now = deps.clock()
        const property: Property = {
          id,
          organizationId: input.orgId,
          name: input.name,
          slug: input.slug,
          timezone: 'UTC',
          gbpPlaceId: input.gbpPlaceId,
          googleConnectionId: input.googleConnectionId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          lifecycleState: 'active',
          lifecycleReason: null,
          lifecycleStateChangedAt: now,
          purgeScheduledFor: null,
          lifecycleInitiatedBy: null,
          ...DEFAULT_PROPERTY_ROUTING,
        }
        const inserted = await deps.repo.insertAndReturn(input.orgId, property)
        await emitAndRecord(
          deps.events,
          deps.outboxRepo,
          propertyCreated({
            propertyId: inserted.id,
            organizationId: inserted.organizationId,
            name: inserted.name,
            slug: inserted.slug,
            gbpPlaceId: inserted.gbpPlaceId ?? undefined,
            googleConnectionId: inserted.googleConnectionId ?? undefined,
            occurredAt: inserted.createdAt,
          }),
        )
        return {
          id: inserted.id,
          organizationId: inserted.organizationId,
          name: inserted.name,
          slug: inserted.slug,
          gbpPlaceId: inserted.gbpPlaceId,
          createdAt: inserted.createdAt,
        }
      } catch (err) {
        const isPg23505 =
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        if (isPg23505) {
          throw propertyImportConflict(
            `Duplicate property for gbpPlaceId=${input.gbpPlaceId}`,
          )
        }
        throw err
      }
    },
    findExistingGbpPlaceIds: async (orgId, gbpPlaceIds) => {
      return deps.repo.findExistingGbpPlaceIds(orgId, gbpPlaceIds)
    },
    existsByGbpPlaceId: async (orgId, gbpPlaceId) => {
      return deps.repo.existsByGbpPlaceId(orgId, gbpPlaceId)
    },
  }

  return { publicApi, internal: { repos: {} as const, useCases } } as const
}
