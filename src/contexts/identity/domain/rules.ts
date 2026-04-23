// Identity context — domain rules
// Pure functions for validating identity-related operations.
// Per architecture: "Pure business rules. No async, no I/O, no throws."

import type { Role } from '#/shared/domain/roles'
import { hasRole } from '#/shared/domain/roles'
import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { IdentityError } from './errors'
import { identityError } from './errors'

/** Validate an organization slug format. */
export function validateSlug(slug: string): Result<string, IdentityError> {
  const trimmed = slug.trim()

  if (trimmed.length < 2) {
    return err(identityError('invalid_slug', 'Slug must be at least 2 characters'))
  }

  if (trimmed.length > 63) {
    return err(identityError('invalid_slug', 'Slug must be at most 63 characters'))
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(trimmed) && trimmed.length > 1) {
    return err(
      identityError(
        'invalid_slug',
        'Slug must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen',
      ),
    )
  }

  return ok(trimmed)
}

/** Validate an organization name. */
export function validateOrganizationName(name: string): Result<string, IdentityError> {
  const trimmed = name.trim()

  if (trimmed.length < 2) {
    return err(
      identityError('invalid_name', 'Organization name must be at least 2 characters'),
    )
  }

  if (trimmed.length > 100) {
    return err(
      identityError('invalid_name', 'Organization name must be at most 100 characters'),
    )
  }

  return ok(trimmed)
}

/** Validate that a user can invite another user with the given role. */
export function canInviteWithRole(
  inviterRole: Role,
  targetRole: Role,
): Result<true, IdentityError> {
  // Must be at least PropertyManager to invite
  if (!hasRole(inviterRole, 'PropertyManager')) {
    return err(identityError('forbidden', 'Insufficient role to invite members'))
  }

  // Cannot invite someone with a higher role than your own
  if (!hasRole(inviterRole, targetRole)) {
    return err(
      identityError(
        'forbidden',
        `Cannot invite with role '${targetRole}' — exceeds your own role`,
      ),
    )
  }

  return ok(true)
}

/** Normalize a string into a URL-friendly slug.
 * Pure string transformation, no Result needed (can't fail).
 * Matches the canonical pattern from docs/patterns.md. */
export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
}

/** Check if a user can change another user's role. */
export function canChangeRole(
  changerRole: Role,
  currentTargetRole: Role,
  newTargetRole: Role,
): Result<true, IdentityError> {
  // Must be at least PropertyManager to change roles
  if (!hasRole(changerRole, 'PropertyManager')) {
    return err(identityError('forbidden', 'Insufficient role to change member roles'))
  }

  // Cannot change role of someone with higher or equal role
  if (hasRole(currentTargetRole, changerRole)) {
    return err(
      identityError(
        'forbidden',
        'Cannot change the role of a member with equal or higher role',
      ),
    )
  }

  // Cannot assign a role higher than your own
  if (!hasRole(changerRole, newTargetRole)) {
    return err(
      identityError(
        'forbidden',
        `Cannot assign role '${newTargetRole}' — exceeds your own role`,
      ),
    )
  }

  return ok(true)
}
