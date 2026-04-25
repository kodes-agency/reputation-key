// Property context — domain rules
// Pure business rules. No async, no I/O, no throws. Validation returns Result.
// Per architecture: "Pure business rules. No async, no I/O, no throws."
//
// Authorization checks have been moved to the centralized permission system
// in shared/domain/permissions.ts (can() function). This file retains only
// pure validation rules.
import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'
import type { PropertyError } from './errors'
import { propertyError } from './errors'

// ── Slug validation ────────────────────────────────────────────────

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

/** Normalize a string into a URL-friendly slug (infallible). */
export const normalizeSlug = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)

/** Validate a slug format. */
export const validateSlug = (slug: string): Result<string, PropertyError> =>
  SLUG_PATTERN.test(slug)
    ? ok(slug)
    : err(propertyError('invalid_slug', 'slug must be URL-friendly and 2-64 chars'))

// ── Name validation ────────────────────────────────────────────────

/** Validate a property name. */
export const validatePropertyName = (name: string): Result<string, PropertyError> => {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return err(propertyError('invalid_name', 'Property name is required'))
  }
  if (trimmed.length > 100) {
    return err(
      propertyError('invalid_name', 'Property name must be at most 100 characters'),
    )
  }
  return ok(trimmed)
}

// ── Timezone validation ────────────────────────────────────────────

// VALID_TIMEZONES is defined in shared/domain/timezones.ts — imported above.
// Re-exported for backward compatibility with existing consumers.
export { VALID_TIMEZONES } from '#/shared/domain/timezones'

/** Validate that a timezone string is a recognized IANA timezone. */
export const validateTimezone = (tz: string): Result<string, PropertyError> => {
  if (VALID_TIMEZONES.includes(tz)) {
    return ok(tz)
  }
  return err(propertyError('invalid_timezone', `Unknown timezone: ${tz}`))
}
