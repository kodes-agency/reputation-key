// Property context — update property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdatePropertyInput } from '../dto/update-property.dto'
import { can } from '#/shared/domain/permissions'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import { validatePropertyName, validateSlug, validateTimezone } from '../../domain/rules'
import { propertyError } from '../../domain/errors'
import { propertyUpdated } from '../../domain/events'

export type UpdatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  clock: () => Date
}>

export const updateProperty =
  (deps: UpdatePropertyDeps) =>
  async (input: UpdatePropertyInput, ctx: AuthContext): Promise<Property> => {
    // 1. Authorize
    if (!can(ctx.role, 'property.update')) {
      throw propertyError('forbidden', 'this role cannot edit properties')
    }

    // 2. Validate referenced entity exists
    const propertyId = toPropertyId(input.propertyId)
    const existing = await deps.propertyRepo.findById(ctx.organizationId, propertyId)
    if (!existing) {
      throw propertyError('property_not_found', 'property not found in this organization')
    }

    // 3. Check uniqueness if slug is changing
    const newSlug = input.slug ?? existing.slug
    if (input.slug && input.slug !== existing.slug) {
      const slugResult = validateSlug(input.slug)
      if (slugResult.isErr()) throw slugResult.error

      if (
        await deps.propertyRepo.slugExists(ctx.organizationId, input.slug, propertyId)
      ) {
        throw propertyError('slug_taken', 'a property with this slug already exists')
      }
    }

    // 4. Validate individual fields if provided
    const newName = input.name ?? existing.name
    if (input.name !== undefined) {
      const nameResult = validatePropertyName(input.name)
      if (nameResult.isErr()) throw nameResult.error
    }

    const newTimezone = input.timezone ?? existing.timezone
    if (input.timezone !== undefined) {
      const tzResult = validateTimezone(input.timezone)
      if (tzResult.isErr()) throw tzResult.error
    }

    const newGbpPlaceId =
      input.gbpPlaceId !== undefined ? input.gbpPlaceId : existing.gbpPlaceId

    // Skip persist + event if nothing actually changed
    const hasChanges =
      newName !== existing.name ||
      newSlug !== existing.slug ||
      newTimezone !== existing.timezone ||
      newGbpPlaceId !== existing.gbpPlaceId

    if (!hasChanges) {
      return existing
    }

    // 5. Persist
    const updatedAt = deps.clock()
    await deps.propertyRepo.update(ctx.organizationId, propertyId, {
      name: newName,
      slug: newSlug,
      timezone: newTimezone,
      gbpPlaceId: newGbpPlaceId,
      updatedAt,
    })

    // 6. Emit event
    deps.events.emit(
      propertyUpdated({
        propertyId,
        organizationId: ctx.organizationId,
        name: newName,
        slug: newSlug,
        occurredAt: updatedAt,
      }),
    )

    // 7. Return updated property
    return {
      ...existing,
      name: newName,
      slug: newSlug,
      timezone: newTimezone,
      gbpPlaceId: newGbpPlaceId,
      updatedAt,
    }
  }

export type UpdateProperty = ReturnType<typeof updateProperty>
