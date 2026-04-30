// Property context — build function.
// Wires property repos, use cases, and the PublicApi surface.
// Per ADR-0001: the composition root calls this and passes publicApi to consumers.

import type { PropertyRepository } from './application/ports/property.repository'
import type { PropertyPublicApi } from './application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { createProperty } from './application/use-cases/create-property'
import { updateProperty } from './application/use-cases/update-property'
import { listProperties } from './application/use-cases/list-properties'
import { getProperty } from './application/use-cases/get-property'
import { softDeleteProperty } from './application/use-cases/soft-delete-property'
import { propertyId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type PropertyContextDeps = Readonly<{
  repo: PropertyRepository
  events: EventBus
  clock: () => Date
  staffPublicApi: StaffPublicApi
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
      events: deps.events,
      clock: deps.clock,
    }),
    listProperties: listProperties({
      propertyRepo: deps.repo,
      staffApi: deps.staffPublicApi,
    }),
    getProperty: getProperty({
      propertyRepo: deps.repo,
    }),
    softDeleteProperty: softDeleteProperty({
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
  }

  return { useCases, publicApi } as const
}
