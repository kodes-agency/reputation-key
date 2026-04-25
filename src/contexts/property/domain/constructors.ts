// Property context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { Result } from 'neverthrow'
import type { Property, PropertyId } from './types'
import type { PropertyError } from './errors'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  normalizeSlug,
  validateSlug,
  validatePropertyName,
  validateTimezone,
} from './rules'

export type BuildPropertyInput = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  providedSlug?: string
  timezone: string
  gbpPlaceId?: string | null
  now: Date
}>

export const buildProperty = (
  input: BuildPropertyInput,
): Result<Property, PropertyError> => {
  const nameResult = validatePropertyName(input.name)
  const slug = validateSlug(input.providedSlug ?? normalizeSlug(input.name))
  const tz = validateTimezone(input.timezone)

  return Result.combine([nameResult, slug, tz]).map(
    ([validName, validSlug, validTz]): Property => ({
      id: input.id,
      organizationId: input.organizationId,
      name: validName,
      slug: validSlug,
      timezone: validTz,
      gbpPlaceId: input.gbpPlaceId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }),
  )
}
