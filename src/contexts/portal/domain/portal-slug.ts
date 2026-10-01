// Portal context — automatic slug suffix.
//
// A name that derives to a slug already in use at the Property gets the next
// free numbered variant instead of an error ("rooftop-pool", "rooftop-pool-2").
// Pure: the caller does the lookups; this only builds the candidates.

import { SLUG_PATTERN, normalizeSlug } from '#/shared/domain/slug'

const SLUG_MAX_LENGTH = 64

/** The base of a name that leaves no usable address, and of the id-based one. */
export const FALLBACK_SLUG_BASE = 'portal'

/** The address a name stands for, before any numbering; empty when it stands for none. */
function derivedAddress(name: string): string {
  const derived = normalizeSlug(name).replace(/-+$/, '')
  return SLUG_PATTERN.test(derived) ? derived : ''
}

/**
 * Whether the name gives an address of its own. A Cyrillic name (the Bulgarian
 * launch market), a single letter or symbols only give none, and the Portal's id
 * stands in: see `idBasedPortalSlug`.
 */
export function hasUsablePortalAddress(name: string): boolean {
  return derivedAddress(name) !== ''
}

/** The address a name stands for; a plain word for one that stands for none. */
export function portalSlugBase(name: string): string {
  return derivedAddress(name) || FALLBACK_SLUG_BASE
}

/** How much of the id each try uses: a longer slice only when a shorter one is held. */
export const ID_SLUG_LENGTHS: readonly number[] = [8, 12, 20, 32]

/**
 * The address of a Portal whose name gives none: the start of its id, so two
 * Portals named in Cyrillic never compete for one numbered base. The address is
 * internal (guests arrive by token), so it is never shown as a choice.
 */
export function idBasedPortalSlug(portalId: string, length: number): string {
  const key = portalId.toLowerCase().replace(/[^a-z0-9]/g, '')
  const room = SLUG_MAX_LENGTH - FALLBACK_SLUG_BASE.length - 1
  const slice = key.slice(0, Math.min(length, room))
  return slice === '' ? FALLBACK_SLUG_BASE : `${FALLBACK_SLUG_BASE}-${slice}`
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
