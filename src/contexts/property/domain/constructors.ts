// Property context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { Result } from '#/shared/domain'
import { DEFAULT_PROPERTY_ROUTING, type Property, type PropertyId } from './types'
import type { PropertyError } from './errors'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import {
  normalizeSlug,
  validateSlug,
  validatePropertyName,
  validateTimezone,
  normalizeCountryCode,
} from './rules'
import { resolvePropertyRouting } from './processing-routing'
import { ok } from '#/shared/domain'

// fallow-ignore-next-line unused-type
export type BuildPropertyInput = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  providedSlug?: string
  timezone: string
  gbpPlaceId?: string | null
  googleConnectionId?: GoogleConnectionId | null
  /** Optional ISO country; when set, processing region is resolved (BQR-3.5). */
  countryCode?: string | null
  countrySource?: string
  now: Date
}>

export const buildProperty = (
  input: BuildPropertyInput,
): Result<Property, PropertyError> => {
  const nameResult = validatePropertyName(input.name)
  const slug = validateSlug(input.providedSlug ?? normalizeSlug(input.name))
  const tz = validateTimezone(input.timezone)

  const countryResult =
    input.countryCode != null && input.countryCode !== ''
      ? normalizeCountryCode(input.countryCode)
      : ok<string | null, PropertyError>(null)

  return Result.combine([nameResult, slug, tz, countryResult]).map(
    ([validName, validSlug, validTz, countryCode]): Property => {
      const routing = resolvePropertyRouting({
        countryCode,
        countrySource:
          input.countrySource ??
          (countryCode ? 'manual' : DEFAULT_PROPERTY_ROUTING.countrySource),
        now: input.now,
      })

      return {
        id: input.id,
        organizationId: input.organizationId,
        name: validName,
        slug: validSlug,
        timezone: validTz,
        gbpPlaceId: input.gbpPlaceId ?? null,
        googleConnectionId: input.googleConnectionId ?? null,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
        lifecycleState: 'active',
        lifecycleReason: null,
        lifecycleStateChangedAt: input.now,
        purgeScheduledFor: null,
        lifecycleInitiatedBy: null,
        ...routing,
      }
    },
  )
}
