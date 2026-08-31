import type { Notification } from '../domain/types'

export type NotificationPage = Readonly<{
  notifications: ReadonlyArray<Notification>
  hasMore: boolean
}>

/**
 * The only refreshable notification-feed authority.
 *
 * `page`, `unreadCount`, and `watermark` are read from one database snapshot.
 * The watermark is opaque to clients; it exists so observers and diagnostics
 * can prove that the badge and the visible head came from the same read.
 */
export type NotificationFeedHead = Readonly<{
  page: NotificationPage
  unreadCount: number
  watermark: string
}>

/**
 * Convert a limit+1 repository read into an exact page result. The extra row
 * is evidence only and is never returned to the caller.
 */
export function createNotificationPage(
  rows: ReadonlyArray<Notification>,
  limit: number,
): NotificationPage {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('notification page limit must be a positive integer')
  }

  return {
    notifications: rows.slice(0, limit),
    hasMore: rows.length > limit,
  }
}
