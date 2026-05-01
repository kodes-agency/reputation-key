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

// fallow-ignore-next-line unused-type
export type UpdatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  clock: () => Date
}>

function authorize(ctx: AuthContext): void {
  if (!can(ctx.role, 'property.update')) {
    throw propertyError('forbidden', 'this role cannot edit properties')
  }
}

async function resolveExisting(
  deps: UpdatePropertyDeps,
  ctx: AuthContext,
  propertyIdStr: string,
) {
  const propertyId = toPropertyId(propertyIdStr)
  const existing = await deps.propertyRepo.findById(ctx.organizationId, propertyId)
  if (!existing) {
    throw propertyError('property_not_found', 'property not found in this organization')
  }
  return { propertyId, existing }
}

async function validateUpdateFields(
  deps: UpdatePropertyDeps,
  input: UpdatePropertyInput,
  existing: Property,
  propertyId: ReturnType<typeof toPropertyId>,
  organizationId: AuthContext['organizationId'],
) {
  const newSlug = input.slug ?? existing.slug
  if (input.slug && input.slug !== existing.slug) {
    const slugResult = validateSlug(input.slug)
    if (slugResult.isErr()) throw slugResult.error
    if (await deps.propertyRepo.slugExists(organizationId, input.slug, propertyId)) {
      throw propertyError('slug_taken', 'a property with this slug already exists')
    }
  }

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

  return { newName, newSlug, newTimezone, newGbpPlaceId }
}

export const updateProperty =
  (deps: UpdatePropertyDeps) =>
  async (input: UpdatePropertyInput, ctx: AuthContext): Promise<Property> => {
    authorize(ctx)
    const { propertyId, existing } = await resolveExisting(deps, ctx, input.propertyId)
    const fields = await validateUpdateFields(
      deps,
      input,
      existing,
      propertyId,
      ctx.organizationId,
    )

    const hasChanges =
      fields.newName !== existing.name ||
      fields.newSlug !== existing.slug ||
      fields.newTimezone !== existing.timezone ||
      fields.newGbpPlaceId !== existing.gbpPlaceId

    if (!hasChanges) return existing

    const updatedAt = deps.clock()
    await deps.propertyRepo.update(ctx.organizationId, propertyId, {
      name: fields.newName,
      slug: fields.newSlug,
      timezone: fields.newTimezone,
      gbpPlaceId: fields.newGbpPlaceId,
      updatedAt,
    })

    deps.events.emit(
      propertyUpdated({
        propertyId,
        organizationId: ctx.organizationId,
        name: fields.newName,
        slug: fields.newSlug,
        occurredAt: updatedAt,
      }),
    )

    return {
      ...existing,
      name: fields.newName,
      slug: fields.newSlug,
      timezone: fields.newTimezone,
      gbpPlaceId: fields.newGbpPlaceId,
      updatedAt,
    }
  }

// fallow-ignore-next-line unused-type
export type UpdateProperty = ReturnType<typeof updateProperty>
