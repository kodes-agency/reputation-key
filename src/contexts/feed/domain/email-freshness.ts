import type { NotificationEmail } from './notification-types'

const HOUR_MS = 60 * 60_000

/**
 * How long a queued email stays worth sending once it is due. Rows queue even
 * while outbound email is dark for an Organization or a Property — the
 * capability gates the send, never the insert — so admitting email later, or
 * lifting a stop, must not release weeks of "act now" mail about work handled
 * long ago. Past its bound a row is suppressed as `stale`, never deleted: the
 * record that mail was owed stays.
 *
 * - Immediate mail: a day, well past its retry schedule.
 * - Daily-digest rows: two days, a full digest cycle plus quiet hours.
 * - Mandatory Organization notices: a week. They must go out, and they are
 *   rare, but an access notice months late is noise.
 *
 * Once attempted, an immediate row — a mandatory notice included — is also
 * retired 23 hours after its first attempt (`RETRY_HORIZON_MS`), whatever its
 * age bound says.
 */
const MAX_AGE_MS = {
  immediate: 24 * HOUR_MS,
  daily: 48 * HOUR_MS,
  mandatory: 7 * 24 * HOUR_MS,
} as const

/**
 * How long after its FIRST provider attempt an immediate row may still be
 * retried. The provider forgets an idempotency key after 24 hours; past that,
 * retrying an attempt it may have accepted (a 5xx, a timeout, a lost answer)
 * sends a second email. The hour of margin covers clock skew and a retry
 * already in flight. A daily-digest row is retried through its batch, whose
 * attempts run on the hourly tick within a five-attempt budget.
 */
const RETRY_HORIZON_MS = 23 * HOUR_MS

type QueuedEmail = Pick<
  NotificationEmail,
  'category' | 'cadence' | 'createdAt' | 'notBefore' | 'attemptedAt'
>

/**
 * A quiet-hours deferral re-dates the row through `notBefore`: the recipient
 * chose that wait, so it never counts against the row.
 */
const dueSince = (email: QueuedEmail): Date =>
  email.notBefore && email.notBefore > email.createdAt ? email.notBefore : email.createdAt

const pastRetryHorizon = (email: QueuedEmail, now: Date): boolean =>
  email.cadence === 'immediate' &&
  email.attemptedAt !== null &&
  now.getTime() - email.attemptedAt.getTime() >= RETRY_HORIZON_MS

export function isStaleQueuedEmail(email: QueuedEmail, now: Date): boolean {
  const maxAge =
    email.category === 'mandatory' ? MAX_AGE_MS.mandatory : MAX_AGE_MS[email.cadence]
  return (
    now.getTime() - dueSince(email).getTime() > maxAge || pastRetryHorizon(email, now)
  )
}

/** The suppression reason a stale row is retired with. */
export const STALE_EMAIL_REASON = 'stale'
