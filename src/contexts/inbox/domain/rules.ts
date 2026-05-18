// Inbox context — domain rules

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { InboxStatus } from './types'
import type { InboxError } from './errors'
import { inboxError } from './errors'

const VALID_TRANSITIONS: Readonly<Record<InboxStatus, readonly InboxStatus[]>> = {
  new: ['read', 'archived', 'escalated'],
  read: ['addressed', 'escalated'],
  escalated: ['addressed', 'archived'],
  addressed: ['archived'],
  archived: ['read'],
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

/** Returns true when the given role is allowed to assign inbox items. */
export const canAssign = (role: string): boolean => {
  return role === 'PropertyManager' || role === 'AccountAdmin'
}

/** Validates assignment eligibility, returning `Result` with error on failure. */
export const validateAssignment = (role: string): Result<true, InboxError> => {
  if (!canAssign(role)) {
    return err(
      inboxError('assignment_not_allowed', `Role '${role}' cannot assign inbox items`, { role }),
    )
  }
  return ok(true)
}
