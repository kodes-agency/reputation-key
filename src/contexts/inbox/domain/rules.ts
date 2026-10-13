// Inbox context — domain rules

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { InboxStatus } from './types'
import type { InboxError } from './errors'
import { inboxError } from './errors'
const VALID_TRANSITIONS: Readonly<Record<InboxStatus, readonly InboxStatus[]>> = {
  open: ['closed'],
  closed: ['open'],
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

/** Returns the timestamp field to stamp when an item enters `status`.
 *  Pure derivation — used by the single-item and bulk status use cases.
 *  Per ADR 0055: only `closedAt` (one field, not four). */
export const timestampFieldsForStatus = (
  status: InboxStatus,
  now: Date,
): Partial<Record<string, Date | null>> => {
  if (status === 'closed') return { closedAt: now }
  return { closedAt: null }
}
