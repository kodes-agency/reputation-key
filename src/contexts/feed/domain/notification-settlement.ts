// Feed notification surface — when a notice stops asking for work.
//
// Some notices report something that happened ("Your reply was approved");
// others ask their reader to do something ("Approve a reply", "Escalated",
// "Follow-up reopened", "Response target passed", "Choose a responsible
// manager"). Only the second kind can go stale: the work gets done, and the
// notice keeps standing in the bell's unread count and keeps a 07:00 email
// queued behind it.
//
// docs/BETA.md says read is not resolved, so the work being done never marks
// a row read. It stamps `resolvedAt` instead: an explicit marker the reader
// sees ("Done"), which leaves the unread count without pretending the reader
// looked. Everything here is keyed on (type, resource): the settling fact
// names a resource, and every actionable notice about that resource retires.

import type { Notification, NotificationType } from './notification-types'

/**
 * The notice types that stand for work still waiting on their reader. A
 * settling fact may retire only these, and only these are held back from
 * email once they are read, dismissed or resolved — an outcome notice
 * ("approved", "published", a role change) is news the reader is owed whether
 * or not they saw it in the app first.
 */
export const ACTIONABLE_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  // An arrival asks for its item to be read and answered ("Open it to read
  // the review and reply"), so it is waiting work until the item is handled.
  'review.created',
  'review.updated',
  'feedback.created',
  'reply.pending_approval',
  'reply.publish_failed',
  'inbox.escalated',
  'inbox.reopened',
  'inbox.bulk_reopened',
  'inbox.response_target_halfway',
  'inbox.response_target_passed',
  'property.responsibility_needed',
  'portal.responsibility_needed',
  // "Reconnect Google" and "Guest portal needs attention" ask for a fix that
  // somebody else can make, and whose absence is then news no longer.
  'integration.reauthorization_required',
  'portal.health_attention',
])

export const isActionableNotificationType = (type: NotificationType): boolean =>
  ACTIONABLE_NOTIFICATION_TYPES.has(type)

/** The upstream facts that finish the work an actionable notice asked for. */
export type SettlingFact =
  | 'reply.decided'
  | 'reply.published'
  | 'reply.returned_to_draft'
  | 'escalation.resolved'
  | 'handling_cycle.closed'
  | 'property.responsibility_restored'
  | 'portal.responsibility_restored'
  | 'google_connection.reconnected'
  | 'google_connection.disconnected'
  | 'portal_health.recovered'

/**
 * A rejection settles the approval request as surely as an approval does:
 * either way nobody is waiting for the reader to decide any more. A
 * publication additionally settles an earlier failed one, because the retry
 * it asked for has now succeeded.
 */
const SETTLED_BY: Readonly<Record<SettlingFact, ReadonlyArray<NotificationType>>> = {
  'reply.decided': ['reply.pending_approval'],
  'reply.published': ['reply.pending_approval', 'reply.publish_failed'],
  // A cancelled publication puts the reply back in draft: there is nothing
  // left to retry, and "Reply returned to draft" says what happened instead.
  'reply.returned_to_draft': ['reply.publish_failed'],
  'escalation.resolved': ['inbox.escalated'],
  // A closed cycle is a handled item: its arrival, the reopen that asked for
  // it and every Response Target reminder about it are answered — whether it
  // was replied to, handled privately or withdrawn by the guest.
  // `inbox.bulk_reopened` is
  // deliberately absent — one grouped notice stands for many items and is
  // filed under the first of them, so closing that one item would retire a
  // notice the rest are still waiting behind. Its own audience already
  // re-counts the items that still stand, at delivery.
  'handling_cycle.closed': [
    'review.created',
    'review.updated',
    'feedback.created',
    'inbox.reopened',
    'inbox.response_target_halfway',
    'inbox.response_target_passed',
  ],
  'property.responsibility_restored': ['property.responsibility_needed'],
  'portal.responsibility_restored': ['portal.responsibility_needed'],
  // A reconnect is the fix asked for. A deliberate disconnect answers it the
  // other way: the connection is gone on purpose, and asking every admin to
  // reconnect it would contradict the admin who removed it.
  'google_connection.reconnected': ['integration.reauthorization_required'],
  'google_connection.disconnected': ['integration.reauthorization_required'],
  // Health that recovered, or moved to a state nobody has to fix (a draft,
  // an archived Property), no longer needs the manager it asked.
  'portal_health.recovered': ['portal.health_attention'],
}

export const settledNotificationTypes = (
  fact: SettlingFact,
): ReadonlyArray<NotificationType> => SETTLED_BY[fact]

/** What the still-actionable predicate needs of a stored row. */
export type ActionableNotificationState = Pick<
  Notification,
  'type' | 'status' | 'resolvedAt' | 'readAt'
>

/**
 * An email-only recipient's anchor: stored read so it stays out of ADR 0046
 * r.2's unread key, but never read by anybody, so it has no read time. Its
 * email is the only way its reader hears of the work.
 */
export const isEmailOnlyAnchor = (
  notification: Pick<Notification, 'status' | 'readAt'>,
): boolean => notification.status === 'read' && notification.readAt === null

/**
 * Whether a queued email still has work to announce, asked immediately before
 * the provider call by both the immediate path and the digest.
 *
 * A notice that reports an outcome always sends. An actionable one sends only
 * while its work is still waiting: unresolved, and neither read nor dismissed
 * by its reader. An email-only anchor counts as unread: its read status is
 * storage, not a reading.
 */
export const isStillActionable = (notification: ActionableNotificationState): boolean =>
  !isActionableNotificationType(notification.type) ||
  (notification.resolvedAt === null &&
    (notification.status === 'unread' || isEmailOnlyAnchor(notification)))

/** The reason a queued email is cancelled because its work was settled. */
export const SETTLED_EMAIL_REASON = 'work_settled' as const

/**
 * The reason a queued email is retired at send time: by then its notice was
 * settled, read or dismissed, so the mail would ask for work nobody is
 * waiting on. Distinct from `work_settled`, which is what the settlement
 * itself writes.
 */
export const NOT_ACTIONABLE_EMAIL_REASON = 'work_no_longer_waiting' as const
