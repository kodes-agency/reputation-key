import { GOVERNING_NOTIFICATION_CATEGORIES } from '../domain/notification-delivery-policy'

/** Canonical server-side feed filters, in the same order as the UI tabs. */
export const NOTIFICATION_LIST_FILTERS = [
  'all',
  'unread',
  'urgent',
  ...GOVERNING_NOTIFICATION_CATEGORIES,
] as const

export type NotificationListFilter = (typeof NOTIFICATION_LIST_FILTERS)[number]
