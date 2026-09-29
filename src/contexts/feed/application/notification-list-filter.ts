import { GOVERNING_NOTIFICATION_CATEGORIES } from '../domain/notification-delivery-policy'

/**
 * Canonical server-side feed filters. `needs_you` and `updates` split the feed
 * the way the bell and the page read it (docs/design/notifications, D1–D2):
 * what still waits on the reader, and everything else. The rest stay for
 * filter-scoped "Mark all read" and for links written before the split.
 */
export const NOTIFICATION_LIST_FILTERS = [
  'all',
  'needs_you',
  'updates',
  'unread',
  'urgent',
  ...GOVERNING_NOTIFICATION_CATEGORIES,
] as const

export type NotificationListFilter = (typeof NOTIFICATION_LIST_FILTERS)[number]
