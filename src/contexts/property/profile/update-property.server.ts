// Property context — update property use case

import type { PropertyRepository } from './property-repository.port.server'
import { loadAccessibleProperty } from './load-accessible-property.server'
import type { PropertyCommandStore } from './update-store.port.server'
import type { Property } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { UpdatePropertyInput } from './contracts'
export type { UpdatePropertyInput } from './contracts'
import {
  normalizeCountryCode,
  validatePropertyName,
  validateSlug,
  validateTimezone,
} from '../domain/rules'
import { propertyError } from '../domain/errors'
import { propertyUpdated } from '../domain/events'
import type { StaffPublicApi } from '#/contexts/identity/public-api'

export type UpdatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  staffPublicApi: StaffPublicApi
  commandStore: PropertyCommandStore
  clock: () => Date
}>

async function assertSlugAvailable(
  deps: UpdatePropertyDeps,
  input: UpdatePropertyInput,
  existing: Property,
  propertyId: PropertyId,
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

/**
 * The country this request changes, or null when it carries none or repeats the
 * stored one. The Profile form sends the country with every save, so repeating
 * it is not an edit: it must not rewrite the row or the source the country was
 * recorded under. A country the manager does change is the tenant confirming
 * it, as a timezone they change is, and Reporting's setup facts accept no other
 * source for either.
 */
function resolveCountryUpdate(
  existing: Property,
  countryCodeInput: string | undefined,
): Readonly<{ countryCode: string; countrySource: 'tenant_confirmed' }> | null {
  if (countryCodeInput === undefined) return null
  const countryResult = normalizeCountryCode(countryCodeInput)
  if (countryResult.isErr()) throw countryResult.error
  if (countryResult.value === existing.countryCode) return null
  return { countryCode: countryResult.value, countrySource: 'tenant_confirmed' }
}

async function validateUpdateFields(
  deps: UpdatePropertyDeps,
  input: UpdatePropertyInput,
  existing: Property,
  propertyId: PropertyId,
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

  const country = resolveCountryUpdate(existing, input.countryCode)

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
 * leaves as it found it is therefore left out of the write, the country the
 * Profile form always sends included (`resolveCountryUpdate`).
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
    const existing = await loadAccessibleProperty(
      deps,
      input.propertyId,
      ctx,
      'property.update',
      'this role cannot edit properties',
    )
    const propertyId = existing.id

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
