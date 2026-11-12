// Feed notification surface — which notice types stand for work still waiting.
//
// Pure facts about notices that stand for work: no reads, so the bell (in the
// browser) and the email send path can use them. The policy that retires them
// lives in `notify/settle.server.ts`.

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
  // It asks for its review to be read and decided on: waiting work until the
  // item is handled.
  'review.ai_urgent_detected',
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
  // A site waits for an account admin until it is approved, turned off or held
  // back, or its Property is archived.
  'portal.link_approval',
  // "Reconnect Google" and "Guest portal needs attention" ask for a fix that
  // somebody else can make, and whose absence is then news no longer.
  'integration.reauthorization_required',
  'portal.health_attention',
  // "Assigned to you" is the item handed to its reader to handle (D3): it waits
  // on them until the item is handled, its Property archived, or the item moves
  // to somebody else.
  'inbox.assigned',
  // A grouped assignment waits until opened or its Property is archived; its
  // items settling one by one is a follow-up (grouped settlement is built for
  // grouped reopens only).
  'inbox.bulk_assigned',
])

export const isActionableNotificationType = (type: NotificationType): boolean =>
  ACTIONABLE_NOTIFICATION_TYPES.has(type)

/**
 * Warnings a later fact takes back. The Purge Pending final notice asks for
 * nothing, and it is mandatory, so reading it never holds its email back; but
 * once the purge is cancelled "Deletion can start at any time" is simply no
 * longer true, and it must stop standing in the bell and stop being mailed.
 */
export const RETRACTABLE_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'account.organization_purge_pending',
])

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
 * storage, not a reading. A retractable warning sends until it is taken back,
 * whether or not it was read: it is mandatory mail.
 */
export const isStillActionable = (notification: ActionableNotificationState): boolean => {
  if (RETRACTABLE_NOTIFICATION_TYPES.has(notification.type)) {
    return notification.resolvedAt === null
  }
  return (
    !isActionableNotificationType(notification.type) ||
    (notification.resolvedAt === null &&
      (notification.status === 'unread' || isEmailOnlyAnchor(notification)))
  )
}

/** The reason a queued email is cancelled because its work was settled. */
export const SETTLED_EMAIL_REASON = 'work_settled' as const

/**
 * The reason a queued email is retired at send time: by then its notice was
 * settled, read or dismissed, so the mail would ask for work nobody is
 * waiting on. Distinct from `work_settled`, which is what the settlement
 * itself writes.
 */
export const NOT_ACTIONABLE_EMAIL_REASON = 'work_no_longer_waiting' as const

/**
 * `false`: the work is done. `true`: it still waits, or this type's work
 * cannot be checked. `{ itemCount }`: a grouped notice, and how many of its
 * items still wait.
 */
export type NotificationWorkDecision = boolean | Readonly<{ itemCount: number }>

/**
 * A grouped notice mailed hours after it was written says how many of its
 * items still wait, not how many its command touched.
 */
export const withStandingItemCount = (
  notification: Notification,
  work: NotificationWorkDecision,
): Notification =>
  typeof work === 'object'
    ? { ...notification, payload: { ...notification.payload, itemCount: work.itemCount } }
    : notification
