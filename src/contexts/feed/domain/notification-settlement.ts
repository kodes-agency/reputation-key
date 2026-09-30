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

import type {
  Notification,
  NotificationCategory,
  NotificationType,
} from './notification-types'

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
  // "Assigned to you" is the item handed to its reader to handle (D3,
  // docs/design/notifications): it waits on them until the item is handled,
  // its Property archived, or the item moves to somebody else.
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

/** Whether a settling fact may retire this type: work it asked for, or a warning taken back. */
export const isSettleableNotificationType = (type: NotificationType): boolean =>
  isActionableNotificationType(type) || RETRACTABLE_NOTIFICATION_TYPES.has(type)

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
  | 'organization.purge_cancelled'
  | 'property.archived'

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
  // absent here: one grouped notice stands for many items and is filed under
  // the first of them, so closing that one item must not retire a notice the
  // rest are still waiting behind. The same fact settles it by its own rule,
  // once none of its items still stands (`grouped-reopen-settlement.ts`).
  'handling_cycle.closed': [
    'review.created',
    'review.updated',
    'feedback.created',
    'inbox.reopened',
    'inbox.response_target_halfway',
    'inbox.response_target_passed',
    'inbox.assigned',
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
  'organization.purge_cancelled': ['account.organization_purge_pending'],
  // An archived Property is outside the workspace: nothing can be answered,
  // approved or published there, so every notice asking for work on it is
  // finished. This one fact settles by Property rather than by resource. A
  // Google reconnect request is absent: the connection is the
  // Organization's, and the Property only anchored its notice.
  'property.archived': [
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
    'portal.health_attention',
    'inbox.assigned',
    'inbox.bulk_assigned',
  ],
}

/**
 * A notice that retires its own reader's earlier notices about the same item
 * when it is written — never anybody else's.
 *
 * An assignment takes over the ARRIVAL it hands to its assignee ("New review"
 * becomes "Assigned to you: review"), so the bell shows one row for one piece
 * of work. Only an arrival, and only its row in the app: a Low ratings notice
 * and unrated private feedback (Action needed) stay their own notices; an
 * email-only anchor was never in the bell; and the arrival's
 * email is cancelled only when the assignment sends one of its own, or the
 * reader would be left with no email about the item at all. It applies only
 * when the assignment is shown in the app, or the reader would be left with
 * nothing there.
 *
 * An item moving to somebody else retires its previous holder's "Assigned to
 * you" whatever their channels, email included: the work is no longer
 * waiting on them.
 */
export type SupersedeRule = Readonly<{
  types: ReadonlyArray<NotificationType>
  /** Only rows of these categories; null for any. */
  categories: ReadonlyArray<NotificationCategory> | null
  onlyWhenShownInApp: boolean
  /**
   * Retire only rows the reader still sees in the app — never an email-only
   * anchor — and cancel their email only when the new notice sends one.
   */
  keepsEmail: boolean
}>

export const SUPERSEDED_FOR_READER: Readonly<
  Partial<Record<NotificationType, SupersedeRule>>
> = {
  'inbox.assigned': {
    types: ['review.created', 'review.updated', 'feedback.created'],
    categories: ['arrivals'],
    onlyWhenShownInApp: true,
    keepsEmail: true,
  },
  'inbox.unassigned': {
    types: ['inbox.assigned'],
    categories: null,
    onlyWhenShownInApp: false,
    keepsEmail: false,
  },
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
 * The reason the final deletion warning's queued email is cancelled: the
 * purge it announced was called off. Its own code, so an operator can tell a
 * withdrawn warning from finished work.
 */
export const PURGE_CANCELLED_EMAIL_REASON = 'purge_cancelled' as const

/**
 * The reason a queued email is retired at send time: by then its notice was
 * settled, read or dismissed, so the mail would ask for work nobody is
 * waiting on. Distinct from `work_settled`, which is what the settlement
 * itself writes.
 */
export const NOT_ACTIONABLE_EMAIL_REASON = 'work_no_longer_waiting' as const
