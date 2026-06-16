// Inbox context — domain rules

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import type { InboxStatus } from './types'
import type { InboxError } from './errors'
import { inboxError } from './errors'
const VALID_TRANSITIONS: Readonly<Record<InboxStatus, readonly InboxStatus[]>> = {
  new: ['read', 'addressed', 'archived', 'escalated'],
  read: ['addressed', 'escalated', 'archived'],
  escalated: ['addressed', 'archived'],
  addressed: ['archived', 'escalated'],
  archived: ['new', 'read', 'escalated'],
}

/** Returns true when `from → to` is a legal status transition. Same-status is NOT valid. */
export const canTransition = (from: InboxStatus, to: InboxStatus): boolean => {
  if (from === to) return false
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/** Validates a status transition, returning `Result` with error on failure. */
export const validateTransition = (
  from: InboxStatus,
  to: InboxStatus,
): Result<InboxStatus, InboxError> => {
  if (!canTransition(from, to)) {
    return err(
      inboxError('invalid_transition', `Cannot transition from '${from}' to '${to}'`, {
        from,
        to,
      }),
    )
  }
  return ok(to)
}

/** Returns true when the given role is allowed to assign inbox items.
 *  // Uses can() for permission gating, not hasRole() hierarchy check */
export const canAssign = (role: Role): boolean => {
  return can(role, 'inbox.manage')
}
/** Validates assignment eligibility, returning `Result` with error on failure. */
export const validateAssignment = (role: Role): Result<true, InboxError> => {
  if (!canAssign(role)) {
    return err(
      inboxError('assignment_not_allowed', `Role '${role}' cannot assign inbox items`, {
        role,
      }),
    )
  }
  return ok(true)
}
