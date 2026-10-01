// Portal context — automatic slug suffix.
//
// A name that derives to a slug already in use at the Property gets the next
// free numbered variant instead of an error ("rooftop-pool", "rooftop-pool-2").
// Pure: the caller does the lookups; this only builds the candidates.

import { SLUG_PATTERN, normalizeSlug } from '#/shared/domain/slug'

const SLUG_MAX_LENGTH = 64

/**
 * The base used when a name leaves no usable address: a Cyrillic name, a single
 * letter, symbols only. The address is internal (guests arrive by token), so a
 * fixed word, numbered like any other, is enough.
 */
export const FALLBACK_SLUG_BASE = 'portal'

/** The address a name stands for, or the fallback base when it stands for none. */
export function portalSlugBase(name: string): string {
  const derived = normalizeSlug(name).replace(/-+$/, '')
  return SLUG_PATTERN.test(derived) ? derived : FALLBACK_SLUG_BASE
}

/** How many numbered candidates are tried before the name is refused as taken. */
export const MAX_SLUG_SUFFIX_ATTEMPTS = 50

/**
 * The slug for the nth attempt: the base itself on attempt 1, then `base-2`,
 * `base-3`. A base with no room for the suffix is cut first; a hyphen left at
 * the cut is dropped so the result still matches the slug pattern.
 */
export function slugWithSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base
  const suffix = `-${attempt}`
  const room = SLUG_MAX_LENGTH - suffix.length
  const trimmed = base.slice(0, room).replace(/-+$/, '')
  return `${trimmed}${suffix}`
}
