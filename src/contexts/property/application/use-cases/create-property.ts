// Property context — create property use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyCommandStore } from '../ports/property-command-store.port'
import type { Property, PropertyId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePropertyInput } from '../dto/create-property.dto'
export type { CreatePropertyInput } from '../dto/create-property.dto'
import { canForContext } from '#/shared/domain/permissions'
import { normalizeSlug } from '../../domain/rules'
import { buildProperty } from '../../domain/constructors'
import { propertyError } from '../../domain/errors'
import { propertyCreated } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type CreatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  commandStore: PropertyCommandStore
  idGen: () => PropertyId
  clock: () => Date
}>

export const createProperty =
  (deps: CreatePropertyDeps) =>
  async (input: CreatePropertyInput, ctx: AuthContext): Promise<Property> => {
    // 1. Authorize
    if (!canForContext(ctx, 'property.create')) {
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

    // 4. Build domain object (BQR-3.5: optional country resolves processing region)
    const propertyResult = buildProperty({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      name: input.name,
      providedSlug: input.slug,
      timezone: input.timezone,
      gbpPlaceId: input.gbpPlaceId,
      countryCode: input.countryCode ?? null,
      countrySource: input.countryCode ? 'manual' : undefined,
      now: deps.clock(),
    })

    if (propertyResult.isErr()) {
      throw propertyResult.error
    }

    const property = propertyResult.value

    // 5. Persist + fact — atomic via the command store (BQC-3.5)
    await deps.commandStore.createProperty({
      organizationId: ctx.organizationId,
      property,
      event: propertyCreated({
        propertyId: property.id,
        organizationId: property.organizationId,
        name: property.name,
        slug: property.slug,
        gbpPlaceId: property.gbpPlaceId ?? undefined,
        googleConnectionId: property.googleConnectionId ?? undefined,
        // BQC-4.1: content-free routing fact travels with the creation fact.
        processingRegion: property.processingRegion ?? undefined,
        occurredAt: property.createdAt,
      }),
    })

    // 7. Return
    return property
  }

// fallow-ignore-next-line unused-type
export type CreateProperty = ReturnType<typeof createProperty>
