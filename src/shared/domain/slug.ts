// Shared domain — slug validation utility
// Pure validation used across multiple contexts (property, portal).
// Per architecture: cross-context pure utilities live in shared/domain.

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'

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

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

/**
 * Validate a slug format against the shared slug pattern.
 * Returns the slug string on success, or the slug string on failure.
 * Consumers wrap this with their own error type.
 */
export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug)

/**
 * Validate a slug, returning a Result with the provided error type on failure.
 * @param slug The slug to validate
 * @param makeError A function that creates the context-specific error
 */
export function validateSlug<E>(
  slug: string,
  makeError: (message: string) => E,
): Result<string, E> {
  return SLUG_PATTERN.test(slug)
    ? ok(slug)
    : err(makeError('slug must be URL-friendly and 2-64 chars'))
}
