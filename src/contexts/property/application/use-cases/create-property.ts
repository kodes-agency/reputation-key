// Property context — create property use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PropertyRepository } from '../ports/property.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { Property, PropertyId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePropertyInput } from '../dto/create-property.dto'
import { can } from '#/shared/domain/permissions'
import { normalizeSlug } from '../../domain/rules'
import { buildProperty } from '../../domain/constructors'
import { propertyError } from '../../domain/errors'
import { propertyCreated } from '../../domain/events'

export type CreatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  idGen: () => PropertyId
  clock: () => Date
}>

export const createProperty =
  (deps: CreatePropertyDeps) =>
  async (input: CreatePropertyInput, ctx: AuthContext): Promise<Property> => {
    // 1. Authorize
    if (!can(ctx.role, 'property.create')) {
      throw propertyError('forbidden', 'this role cannot create properties')
    }

    // 2. (No referenced entities to validate for property creation)

    // 3. Check uniqueness — slug must be unique per org
    const candidateSlug = input.slug ?? normalizeSlug(input.name)
    if (await deps.propertyRepo.slugExists(ctx.organizationId, candidateSlug)) {
      throw propertyError(
        'slug_taken',
        'a property with this slug already exists in this organization',
      )
    }

    // 4. Build domain object
    const propertyResult = buildProperty({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      name: input.name,
      providedSlug: input.slug,
      timezone: input.timezone,
      gbpPlaceId: input.gbpPlaceId,
      now: deps.clock(),
    })

    if (propertyResult.isErr()) {
      throw propertyResult.error
    }

    const property = propertyResult.value

    // 5. Persist
    await deps.propertyRepo.insert(ctx.organizationId, property)

    // 6. Emit event
    deps.events.emit(
      propertyCreated({
        propertyId: property.id,
        organizationId: property.organizationId,
        name: property.name,
        slug: property.slug,
        occurredAt: property.createdAt,
      }),
    )

    // 7. Return
    return property
  }

export type CreateProperty = ReturnType<typeof createProperty>
