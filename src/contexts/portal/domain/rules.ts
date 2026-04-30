// Portal context — domain rules
// Pure business rules. No async, no I/O, no throws. Validation returns Result.
// Per architecture: "Pure business rules. No async, no I/O, no throws."

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { PortalError } from './errors'
import { portalError } from './errors'
import type { PortalTheme } from './types'

// ── Slug validation ────────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

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
export const validateSlug = (slug: string): Result<string, PortalError> =>
  SLUG_PATTERN.test(slug)
    ? ok(slug)
    : err(portalError('invalid_slug', 'slug must be URL-friendly and 2-64 chars'))

// ── Name validation ────────────────────────────────────────────────

/** Validate a portal name. */
export const validatePortalName = (name: string): Result<string, PortalError> => {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return err(portalError('invalid_name', 'Portal name is required'))
  }
  if (trimmed.length > 100) {
    return err(portalError('invalid_name', 'Portal name must be at most 100 characters'))
  }
  return ok(trimmed)
}

// ── Description validation ─────────────────────────────────────────

/** Validate a portal description. Nullable, max 500 chars. */
export const validateDescription = (
  desc: string | null | undefined,
): Result<string | null, PortalError> => {
  if (desc === null || desc === undefined) return ok(null)
  if (desc.length > 500) {
    return err(
      portalError('invalid_description', 'Description must be at most 500 characters'),
    )
  }
  return ok(desc)
}

// ── Theme validation ───────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Validate a portal theme. */
export const validatePortalTheme = (
  theme: Partial<PortalTheme>,
): Result<PortalTheme, PortalError> => {
  if (!theme.primaryColor || !HEX_COLOR.test(theme.primaryColor)) {
    return err(
      portalError(
        'invalid_theme',
        'primaryColor must be a valid hex color (e.g. #FF5500)',
      ),
    )
  }
  if (theme.backgroundColor && !HEX_COLOR.test(theme.backgroundColor)) {
    return err(portalError('invalid_theme', 'backgroundColor must be a valid hex color'))
  }
  if (theme.textColor && !HEX_COLOR.test(theme.textColor)) {
    return err(portalError('invalid_theme', 'textColor must be a valid hex color'))
  }
  return ok({
    primaryColor: theme.primaryColor,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
  })
}

// ── Smart routing threshold ────────────────────────────────────────

/** Validate smart routing threshold (1-4). */
export const validateSmartRoutingThreshold = (n: number): Result<number, PortalError> => {
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    return err(
      portalError('invalid_threshold', 'Threshold must be an integer between 1 and 4'),
    )
  }
  return ok(n)
}

// ── URL validation ─────────────────────────────────────────────────

/** Validate a URL for portal links. */
export const validateUrl = (url: string): Result<string, PortalError> => {
  try {
    new URL(url)
    return ok(url)
  } catch {
    return err(portalError('invalid_url', 'Must be a valid URL'))
  }
}

// ── Link label validation ──────────────────────────────────────────

/** Validate a link label. */
export const validateLinkLabel = (label: string): Result<string, PortalError> => {
  const trimmed = label.trim()
  if (trimmed.length < 1) {
    return err(portalError('invalid_label', 'Link label is required'))
  }
  if (trimmed.length > 100) {
    return err(portalError('invalid_label', 'Link label must be at most 100 characters'))
  }
  return ok(trimmed)
}

// ── Category title validation ──────────────────────────────────────

/** Validate a category title. */
export const validateCategoryTitle = (title: string): Result<string, PortalError> => {
  const trimmed = title.trim()
  if (trimmed.length < 1) {
    return err(portalError('invalid_title', 'Category title is required'))
  }
  if (trimmed.length > 100) {
    return err(
      portalError('invalid_title', 'Category title must be at most 100 characters'),
    )
  }
  return ok(trimmed)
}
