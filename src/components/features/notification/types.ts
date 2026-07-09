// Aggregated type of the notification server fns the NotificationPanel consumes.
// Routes construct the bundle and pass it as `notificationFns`; the hooks in
// notification-queries receive the relevant fn and wrap it internally.
// Type-only imports (typeof prop typing) — allowed by the boundary gate.
import type {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  markNotificationReadFn,
  markAllNotificationsReadFn,
  dismissNotificationFn,
} from '#/contexts/notification/server/notifications'

export type NotificationServerFns = Readonly<{
  getUnreadCount: typeof getUnreadNotificationCountFn
  getList: typeof getNotificationsFn
  markRead: typeof markNotificationReadFn
  markAllRead: typeof markAllNotificationsReadFn
  dismiss: typeof dismissNotificationFn
}>
