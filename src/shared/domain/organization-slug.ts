// Shared domain — the slug an Organization gets from its name.
//
// One derivation for `ops:bootstrap-owner` (the first Organization) and the
// operator console (every later one), so both name Organizations the same
// way. Browser-safe: the console's create dialog prefills its slug field with
// it. Server-side validation stays with Identity's `validateSlug`.

/** A derived slug never exceeds this many characters. */
export const ORGANIZATION_SLUG_DERIVED_MAX = 60

const FALLBACK_SLUG = 'organization'

const trimHyphens = (value: string): string => value.replace(/^-+|-+$/gu, '')

/**
 * Lowercase, join every run of characters outside a-z0-9 with one hyphen,
 * trim hyphens, cap at 60 without ending on a hyphen; '' → 'organization'.
 */
export function deriveOrganizationSlug(name: string): string {
  const joined = trimHyphens(name.toLowerCase().replace(/[^a-z0-9]+/gu, '-'))
  const slug = trimHyphens(joined.slice(0, ORGANIZATION_SLUG_DERIVED_MAX))
  return slug || FALLBACK_SLUG
}
