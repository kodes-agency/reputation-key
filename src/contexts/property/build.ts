// Property context — build function.
// Wires property repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { Database } from '#/shared/db'

import type { PropertyRepository } from './application/ports/property.repository'
import type { PropertyPublicApi } from './application/public-api'
import { propertyImportConflict } from './application/public-api'
import { propertyCreated } from './domain/events'
import type { Property } from './domain/types'
import { resolvePropertyRouting } from './domain/processing-routing'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { createProperty } from './application/use-cases/create-property'
import { updateProperty } from './application/use-cases/update-property'
import { listProperties } from './application/use-cases/list-properties'
import { getProperty } from './application/use-cases/get-property'
import { deleteProperty } from './application/use-cases/soft-delete-property'
import { createAtomicPropertyCommandStore } from './infrastructure/property-command-store'
import { propertyId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type PropertyContextDeps = Readonly<{
  db: Database
  repo: PropertyRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export const buildPropertyContext = (deps: PropertyContextDeps) => {
  const idGen = () => propertyId(randomUUID())
  // BQC-3.5: every property state mutation + fact commits atomically here.
  const commandStore = createAtomicPropertyCommandStore(deps.db, deps.events)

  const useCases = {
    createProperty: createProperty({
      propertyRepo: deps.repo,
      commandStore,
      idGen,
      clock: deps.clock,
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
    softDeleteProperty: deleteProperty({
      propertyRepo: deps.repo,
      commandStore,
      clock: deps.clock,
      sourceContentPurge: createSourceContentPurge({
        db: deps.db,
        clock: deps.clock,
      }),
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
    // BQC-3.5: the insert + property.created fact commit atomically via the
    // command store; the integration import job no longer re-emits the fact.
    importProperty: async (input) => {
      try {
        const id = idGen()
        const now = deps.clock()
        // BQR-3.5: resolve region from GBP country when present; else explicit unresolved.
        const routing = resolvePropertyRouting({
          countryCode: input.countryCode ?? null,
          countrySource: input.countryCode ? 'google_address' : 'organization_default',
          now,
        })
        const property: Property = {
          id,
          organizationId: input.orgId,
          name: input.name,
          slug: input.slug,
          // Keep UTC placeholder until timezone API enrichment; availability fails closed for AI.
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
          ...routing,
        }
        const inserted = await commandStore.createProperty({
          organizationId: input.orgId,
          property,
          event: propertyCreated({
            propertyId: property.id,
            organizationId: property.organizationId,
            name: property.name,
            slug: property.slug,
            gbpPlaceId: property.gbpPlaceId ?? undefined,
            googleConnectionId: property.googleConnectionId ?? undefined,
            occurredAt: property.createdAt,
          }),
        })
        return {
          id: inserted.id,
          organizationId: inserted.organizationId,
          name: inserted.name,
          slug: inserted.slug,
          gbpPlaceId: inserted.gbpPlaceId,
          createdAt: inserted.createdAt,
        }
      } catch (err) {
        // drizzle wraps driver errors in DrizzleQueryError — the SQLSTATE
        // lives on the cause (accept both shapes).
        const code = (err as { code?: unknown } | null)?.code
        const causeCode = (err as { cause?: unknown } | null)?.cause
        const isPg23505 =
          code === '23505' ||
          (typeof causeCode === 'object' &&
            causeCode !== null &&
            (causeCode as { code?: unknown }).code === '23505')
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
