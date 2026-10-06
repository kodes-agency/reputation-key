// Identity context — domain rules
// Pure functions for validating identity-related operations.
// Per architecture: "Pure business rules. No async, no I/O, no throws."

import type { Role } from '#/shared/domain/roles'
import { hasRole } from '#/shared/domain/roles'
import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { IdentityError } from './errors'
import { identityError } from './errors'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'

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

/** Validate closed-beta manager invitation authority. */
export function canInviteWithRole(
  inviterRole: Role,
  targetRole: Role,
): Result<true, IdentityError> {
  // Defense-in-depth: use case already gates with can(role, 'invitation.create').
  // This ensures the domain rule is independently enforceable even if called outside a use case.
  if (inviterRole !== 'AccountAdmin') {
    return err(
      identityError('forbidden', 'Only Account Admins can invite beta manager accounts'),
    )
  }

  if (!isBetaInteractiveRole(targetRole)) {
    return err(
      identityError(
        'forbidden',
        `Cannot invite with role '${targetRole}' — Member login is not active in beta`,
      ),
    )
  }

  return ok(true)
}

// Re-export shared slug utility for backward compatibility.
// Consumers in this context should migrate to importing from '#/shared/domain'.
export { normalizeSlug } from '#/shared/domain/slug'

/**
 * Check if a user can change a member's role.
 *
 * D2: role administration is AccountAdmin-only, and an AccountAdmin may change
 * any member's role — another AccountAdmin's included. Nobody may change their
 * own role, and the last AccountAdmin stays; the use case enforces both, and
 * the command store re-checks the last-owner rule under the Organization lock.
 */
export function canChangeRole(
  changerRole: Role,
  currentTargetRole: Role,
  newTargetRole: Role,
): Result<true, IdentityError> {
  // Defense-in-depth: use case already gates with can(role, 'member.update').
  // This ensures the domain rule is independently enforceable even if called outside a use case.
  if (changerRole !== 'AccountAdmin') {
    return err(identityError('forbidden', 'Only Account Admins can change member roles'))
  }

  // Cannot change the role of someone above you (unreachable for the top role,
  // kept so the rule does not depend on AccountAdmin being the highest)
  if (!hasRole(changerRole, currentTargetRole)) {
    return err(
      identityError('forbidden', 'Cannot change the role of a member with a higher role'),
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
