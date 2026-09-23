import type { Notification } from '../domain/notification-types'
import { toNotificationView, type NotificationView } from './notification-view'

/**
 * A position in feed order (latest activity DESC, id DESC): the row's latest
 * activity instant and its id. Only the server mints cursors, as a fixed-width
 * UTC timestamp with microseconds and a lowercase uuid, so a page boundary
 * can never fall between two rows that share a millisecond, and two cursors
 * compare lexically in feed order.
 */
export type NotificationFeedCursor = Readonly<{
  at: string
  id: string
}>

export type NotificationPage = Readonly<{
  /** Browser-shaped rows: pages exist only to be sent to the in-app feed. */
  notifications: ReadonlyArray<NotificationView>
  hasMore: boolean
  /** Where the next page starts: the last row's position, or null at the end. */
  nextCursor: NotificationFeedCursor | null
}>

/** One feed row as read, with its position in feed order. */
export type NotificationFeedRow = Readonly<{
  notification: Notification
  cursor: NotificationFeedCursor
}>

/**
 * The only refreshable notification-feed authority.
 *
 * `page`, both counts, and `watermark` are read from one database snapshot.
 * The watermark is opaque to clients; it exists so observers and diagnostics
 * can prove that the badge and the visible head came from the same read.
 */
export type NotificationFeedHead = Readonly<{
  page: NotificationPage
  /** The reader's unread notifications, whatever the filter: the badge. */
  unreadCount: number
  /** How many of those the head's filter holds: what its "Mark all read" would change. */
  filterUnreadCount: number
  watermark: string
}>

/**
 * Convert a limit+1 repository read into an exact page result. The extra row
 * is evidence only and is never returned to the caller.
 */
export function createNotificationPage(
  rows: ReadonlyArray<NotificationFeedRow>,
  limit: number,
): NotificationPage {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('notification page limit must be a positive integer')
  }

  const page = rows.slice(0, limit)
  const hasMore = rows.length > limit
  return {
    notifications: page.map((row) => toNotificationView(row.notification)),
    hasMore,
    nextCursor: hasMore ? (page.at(-1)?.cursor ?? null) : null,
  }
}

/** True when `a` sorts before `b` in the feed: newer activity, or the same instant and a larger id. */
export function isNewerFeedPosition(
  a: NotificationFeedCursor,
  b: NotificationFeedCursor,
): boolean {
  return a.at === b.at ? a.id > b.id : a.at > b.at
}
