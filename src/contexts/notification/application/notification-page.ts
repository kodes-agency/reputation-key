import type { Notification } from '../domain/types'

export type NotificationPage = Readonly<{
  notifications: ReadonlyArray<Notification>
  hasMore: boolean
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
