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
 */
const MAX_AGE_MS = {
  immediate: 24 * HOUR_MS,
  daily: 48 * HOUR_MS,
  mandatory: 7 * 24 * HOUR_MS,
} as const

type QueuedEmail = Pick<
  NotificationEmail,
  'category' | 'cadence' | 'createdAt' | 'notBefore'
>

/**
 * A quiet-hours deferral re-dates the row through `notBefore`: the recipient
 * chose that wait, so it never counts against the row.
 */
const dueSince = (email: QueuedEmail): Date =>
  email.notBefore && email.notBefore > email.createdAt ? email.notBefore : email.createdAt

export function isStaleQueuedEmail(email: QueuedEmail, now: Date): boolean {
  const maxAge =
    email.category === 'mandatory' ? MAX_AGE_MS.mandatory : MAX_AGE_MS[email.cadence]
  return now.getTime() - dueSince(email).getTime() > maxAge
}

/** The suppression reason a stale row is retired with. */
export const STALE_EMAIL_REASON = 'stale'
