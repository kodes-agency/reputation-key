// Same-kind arrivals at one Property read as one row: "3 new reviews".
//
// The server already folds repeats of ONE item into one row (ADR 0046 r.2,
// the ×3 in a row's facts). This folds separate items of the same kind, which
// the server keeps apart on purpose — each has its own link and its own
// settlement. A stack opens the Property's Inbox queue for that kind, where
// the items are worked (D5, docs/design/notifications), rather than one of
// them.
//
// Only kinds that are "more of the same" stack. A stack is never allowed to
// hide one notice among others that ask less: the key carries the category,
// so low-rated reviews and feedback never fold into a stack of arrivals, and
// the waiting state, so a finished item never folds into work.

import {
  isStillWaiting,
  type NotificationType,
  type NotificationView,
} from '#/contexts/feed/application/public-api'

type StackKind = Readonly<{
  title: (count: number) => string
  /** The Inbox queue the stack opens at its Property. */
  queue: 'reply' | 'feedback' | 'open'
}>

const STACK_KINDS: Readonly<Partial<Record<NotificationType, StackKind>>> = {
  'review.created': { title: (count) => `${count} new reviews`, queue: 'reply' },
  'review.updated': { title: (count) => `${count} reviews updated`, queue: 'reply' },
  'feedback.created': {
    title: (count) => `${count} new feedback items`,
    queue: 'feedback',
  },
  'inbox_note.added': { title: (count) => `${count} new internal notes`, queue: 'open' },
}

export type NotificationEntry =
  | Readonly<{ kind: 'row'; notification: NotificationView }>
  | Readonly<{
      kind: 'stack'
      key: string
      /** Newest first, as the feed listed them; at least two. */
      notifications: ReadonlyArray<NotificationView>
    }>

const stackKeyOf = (notification: NotificationView): string | null => {
  if (STACK_KINDS[notification.type] === undefined) return null
  if (notification.propertyId === null) return null
  return [
    notification.type,
    notification.propertyId,
    notification.category,
    isStillWaiting(notification) ? 'waiting' : 'seen',
  ].join('|')
}

/**
 * The rows as entries: each stackable row joins the first earlier row of its
 * kind, at that row's place in the list; a kind seen once stays a plain row.
 */
export function stackNotifications(
  notifications: ReadonlyArray<NotificationView>,
): ReadonlyArray<NotificationEntry> {
  const entries: Array<NotificationEntry | { kind: 'pending'; key: string }> = []
  const stacks = new Map<string, NotificationView[]>()
  for (const notification of notifications) {
    const key = stackKeyOf(notification)
    if (key === null) {
      entries.push({ kind: 'row', notification })
      continue
    }
    const stack = stacks.get(key)
    if (stack) {
      stack.push(notification)
      continue
    }
    stacks.set(key, [notification])
    entries.push({ kind: 'pending', key })
  }
  return entries.map((entry) => {
    if (entry.kind !== 'pending') return entry
    const members = stacks.get(entry.key)!
    return members.length === 1
      ? { kind: 'row', notification: members[0]! }
      : { kind: 'stack', key: entry.key, notifications: members }
  })
}

/** The id a list uses for an entry: a stack answers to its newest member. */
export const entryId = (entry: NotificationEntry): string =>
  entry.kind === 'row' ? entry.notification.id : entry.notifications[0]!.id

export type NotificationStackView = Readonly<{
  title: string
  property: string | null
  queue: StackKind['queue']
  propertyId: string
  isUnread: boolean
  unreadCount: number
  accessibleName: string
}>

/** What a stack row says; `when` is the newest member's time, in words. */
/**
 * A stack of Low ratings notices says so (the key keeps them apart from
 * arrivals); never how many stars (ADR 0046, amended 2026-09-30).
 */
const LOW_RATING_TITLES: Partial<Record<NotificationType, (count: number) => string>> = {
  'review.created': (count) => `${count} low-rated reviews`,
  'review.updated': (count) => `${count} reviews edited to a low rating`,
  'feedback.created': (count) => `${count} low-rated feedback items`,
}

export function notificationStackView(
  notifications: ReadonlyArray<NotificationView>,
  options: Readonly<{ showProperty: boolean; when: string }>,
): NotificationStackView {
  const newest = notifications[0]!
  const kind = STACK_KINDS[newest.type]!
  const lowTitle =
    newest.category === 'low_ratings' ? LOW_RATING_TITLES[newest.type] : undefined
  const title = (lowTitle ?? kind.title)(notifications.length)
  const propertyName = newest.payload.propertyName ?? null
  const unreadCount = notifications.filter(isStillWaiting).length
  const accessibleName = [
    propertyName === null ? title : `${title} at ${propertyName}`,
    `latest ${options.when}`,
    unreadCount > 0 ? `${unreadCount} unread` : '',
  ]
    .filter((part) => part !== '')
    .join(', ')
  return {
    title,
    property: options.showProperty ? propertyName : null,
    queue: kind.queue,
    propertyId: newest.propertyId!,
    isUnread: unreadCount > 0,
    unreadCount,
    accessibleName,
  }
}
