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
import { propertyError } from '../../domain/errors'
import { propertyUpdated } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'

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

function resolveCountryUpdate(
  countryCodeInput: string | undefined,
): Readonly<{ countryCode: string; countrySource: 'manual' }> | null {
  if (countryCodeInput === undefined) return null
  const countryResult = normalizeCountryCode(countryCodeInput)
  if (countryResult.isErr()) throw countryResult.error
  return { countryCode: countryResult.value, countrySource: 'manual' }
}

async function validateUpdateFields(
  deps: UpdatePropertyDeps,
  input: UpdatePropertyInput,
  existing: Property,
  propertyId: ReturnType<typeof toPropertyId>,
  organizationId: AuthContext['organizationId'],
) {
  const newSlug = await assertSlugAvailable(
    deps,
    input,
    existing,
    propertyId,
    organizationId,
  )

  let newName = existing.name
  if (input.name !== undefined) {
    const nameResult = validatePropertyName(input.name)
    if (nameResult.isErr()) throw nameResult.error
    newName = nameResult.value
  }

  let newTimezone = existing.timezone
  if (input.timezone !== undefined) {
    const tzResult = validateTimezone(input.timezone)
    if (tzResult.isErr()) throw tzResult.error
    newTimezone = tzResult.value
  }

  const country = resolveCountryUpdate(input.countryCode)

  return {
    newName,
    newSlug,
    newTimezone,
    newDefaultReplyLanguage:
      input.defaultReplyLanguage === undefined
        ? existing.defaultReplyLanguage
        : input.defaultReplyLanguage,
    country,
  }
}

type ValidatedUpdateFields = Awaited<ReturnType<typeof validateUpdateFields>>

/**
 * The columns this request changes, and nothing else.
 *
 * `existing` was read without a lock, and the command store's fence covers only
 * `sourceEpoch` and `profileVersion`. `profileVersion` moves with the name and
 * the timezone alone (it pins reply drafts and the Google destination), so a
 * slug or reply language repeated here from that read would silently undo
 * another admin's save of it that committed in between. A column the request
 * leaves as it found it is therefore left out of the write.
 */
function changedColumns(
  existing: Property,
  fields: ValidatedUpdateFields,
  updatedAt: Date,
): Readonly<Partial<Property>> {
  const nameChanged = fields.newName !== existing.name
  const timezoneChanged = fields.newTimezone !== existing.timezone
  return {
    ...(nameChanged ? { name: fields.newName } : {}),
    ...(fields.newSlug !== existing.slug ? { slug: fields.newSlug } : {}),
    ...(timezoneChanged
      ? {
          timezone: fields.newTimezone,
          timezoneSource: 'tenant_confirmed',
          timezoneResolvedAt: updatedAt,
        }
      : {}),
    ...(fields.newDefaultReplyLanguage !== existing.defaultReplyLanguage
      ? { defaultReplyLanguage: fields.newDefaultReplyLanguage }
      : {}),
    ...(fields.country ?? {}),
    ...(nameChanged || timezoneChanged
      ? { profileVersion: existing.profileVersion + 1 }
      : {}),
  }
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
    )

    const changes = changedColumns(existing, fields, updatedAt)
    if (Object.keys(changes).length === 0) return existing

    return deps.commandStore.updateProperty({
      organizationId: ctx.organizationId,
      propertyId,
      expectedSourceEpoch: existing.sourceEpoch,
      expectedProfileVersion: existing.profileVersion,
      patch: { ...changes, updatedAt },
      event: (committed) =>
        propertyUpdated({
          propertyId,
          organizationId: ctx.organizationId,
          name: committed.name,
          slug: committed.slug,
          occurredAt: updatedAt,
        }),
    })
  }

export type UpdateProperty = ReturnType<typeof updateProperty>
