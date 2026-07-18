// Property context — update property use case

import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyCommandStore } from '../ports/property-command-store.port'
import type { Property } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdatePropertyInput } from '../dto/update-property.dto'
export type { UpdatePropertyInput } from '../dto/update-property.dto'
import { canForContext } from '#/shared/domain/permissions'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import {
  normalizeCountryCode,
  validatePropertyName,
  validateSlug,
  validateTimezone,
} from '../../domain/rules'
import {
  resolvePropertyRouting,
  wouldChangeResolvedRegion,
} from '../../domain/processing-routing'
import { propertyError } from '../../domain/errors'
import { propertyUpdated } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'

// fallow-ignore-next-line unused-type
export type UpdatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  staffPublicApi: StaffPublicApi
  commandStore: PropertyCommandStore
  clock: () => Date
}>

function authorize(ctx: AuthContext): void {
  if (!canForContext(ctx, 'property.update')) {
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

async function assertSlugAvailable(
  deps: UpdatePropertyDeps,
  input: UpdatePropertyInput,
  existing: Property,
  propertyId: ReturnType<typeof toPropertyId>,
  organizationId: AuthContext['organizationId'],
): Promise<string> {
  const newSlug = input.slug ?? existing.slug
  if (input.slug && input.slug !== existing.slug) {
    const slugResult = validateSlug(input.slug)
    if (slugResult.isErr()) throw slugResult.error
    if (await deps.propertyRepo.slugExists(organizationId, input.slug, propertyId)) {
      throw propertyError('slug_taken', 'a property with this slug already exists')
    }
  }
  return newSlug
}

// BQR-3.5: optional country resolves region; no silent region change once resolved.
function resolveRoutingUpdate(
  existing: Property,
  countryCodeInput: string | undefined,
  now: Date,
): ReturnType<typeof resolvePropertyRouting> | null {
  if (countryCodeInput === undefined) return null
  const countryResult = normalizeCountryCode(countryCodeInput)
  if (countryResult.isErr()) throw countryResult.error
  const countryCode = countryResult.value
  if (wouldChangeResolvedRegion(existing.processingRegion, countryCode)) {
    throw propertyError(
      'region_locked',
      'processing region cannot change after it has been resolved',
      {
        currentRegion: existing.processingRegion,
        attemptedCountry: countryCode,
      },
    )
  }
  return resolvePropertyRouting({
    countryCode,
    countrySource: 'manual',
    now,
    sourceEpoch: existing.sourceEpoch,
    timezoneSource: existing.timezoneSource,
    timezoneResolvedAt: existing.timezoneResolvedAt,
  })
}

async function validateUpdateFields(
  deps: UpdatePropertyDeps,
  input: UpdatePropertyInput,
  existing: Property,
  propertyId: ReturnType<typeof toPropertyId>,
  organizationId: AuthContext['organizationId'],
  now: Date,
) {
  const newSlug = await assertSlugAvailable(
    deps,
    input,
    existing,
    propertyId,
    organizationId,
  )

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

  const routing = resolveRoutingUpdate(existing, input.countryCode, now)

  return { newName, newSlug, newTimezone, newGbpPlaceId, routing }
}

export const updateProperty =
  (deps: UpdatePropertyDeps) =>
  async (input: UpdatePropertyInput, ctx: AuthContext): Promise<Property> => {
    authorize(ctx)
    const { propertyId, existing } = await resolveExisting(deps, ctx, input.propertyId)

    // Enforce property-assignment scoping for PropertyManager (AccountAdmin
    // bypasses via getAccessiblePropertyIds returning null). Mirrors the
    // list-properties read path. (D6-001.)
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, userId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
      ctx,
      'property.update',
      propertyId,
    )
    if (!accessible) {
      throw propertyError('forbidden', 'No access to this property', { propertyId })
    }
    const updatedAt = deps.clock()
    const fields = await validateUpdateFields(
      deps,
      input,
      existing,
      propertyId,
      ctx.organizationId,
      updatedAt,
    )

    const hasChanges =
      fields.newName !== existing.name ||
      fields.newSlug !== existing.slug ||
      fields.newTimezone !== existing.timezone ||
      fields.newGbpPlaceId !== existing.gbpPlaceId ||
      fields.routing !== null

    if (!hasChanges) return existing

    await deps.commandStore.updateProperty({
      organizationId: ctx.organizationId,
      propertyId,
      patch: {
        name: fields.newName,
        slug: fields.newSlug,
        timezone: fields.newTimezone,
        gbpPlaceId: fields.newGbpPlaceId,
        ...(fields.routing ?? {}),
        updatedAt,
      },
      event: propertyUpdated({
        propertyId,
        organizationId: ctx.organizationId,
        name: fields.newName,
        slug: fields.newSlug,
        occurredAt: updatedAt,
      }),
    })

    return {
      ...existing,
      name: fields.newName,
      slug: fields.newSlug,
      timezone: fields.newTimezone,
      gbpPlaceId: fields.newGbpPlaceId,
      ...(fields.routing ?? {}),
      updatedAt,
    }
  }

// fallow-ignore-next-line unused-type
export type UpdateProperty = ReturnType<typeof updateProperty>
