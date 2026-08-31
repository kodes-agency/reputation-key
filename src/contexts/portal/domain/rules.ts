// Portal context — domain rules
// Pure business rules. No async, no I/O, no throws. Validation returns Result.
// Per architecture: "Pure business rules. No async, no I/O, no throws."

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { PortalError } from './errors'
import { portalError } from './errors'
import type { PortalTheme } from './types'
import { isPublicHttpsDestination } from './safe-link'

// ── Slug validation ────────────────────────────────────────────────

// Re-export shared slug utility for backward compatibility.
// Consumers in this context should migrate to importing from '#/shared/domain'.
export { normalizeSlug } from '#/shared/domain/slug'
import { validateSlug as sharedValidateSlug } from '#/shared/domain/slug'

/** Validate a slug format. */
export const validateSlug = (slug: string): Result<string, PortalError> =>
  sharedValidateSlug(slug, (msg) => portalError('invalid_slug', msg))

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

// ── Private feedback threshold ─────────────────────────────────────

/** Validate the inclusive private-feedback threshold (1-5). */
export const validatePrivateFeedbackThreshold = (
  n: number,
): Result<number, PortalError> => {
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return err(
      portalError('invalid_threshold', 'Threshold must be an integer between 1 and 5'),
    )
  }
  return ok(n)
}

// ── URL validation ─────────────────────────────────────────────────

/** Check whether a URL is a valid external HTTPS URL. */
export const isValidExternalUrl = (url: string): boolean => {
  return isPublicHttpsDestination(url)
}

/**
 * Validate a URL for portal links.
 *
 * Delegates to isValidExternalUrl rather than merely parsing: `new URL()` happily
 * accepts `javascript:` and `data:` payloads, and this is the constructor-time gate
 * for link destinations that the public portal later renders as anchors.
 */
export const validateUrl = (url: string): Result<string, PortalError> =>
  isValidExternalUrl(url)
    ? ok(url)
    : err(portalError('invalid_url', 'Must be a valid https:// URL'))

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

// ── Group name validation ──────────────────────────────────────────

/** Validate a portal group name. */
export const validateGroupName = (name: string): Result<string, PortalError> => {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return err(portalError('invalid_name', 'Group name is required'))
  }
  if (trimmed.length > 100) {
    return err(portalError('invalid_name', 'Group name must be at most 100 characters'))
  }
  return ok(trimmed)
}
