// Constructs the NotificationServerFns bundle from raw server fn references.
// Routes are the sanctioned site for importing server fns (CONTEXT.md:55);
// components receive this bundle as a prop and never value-import server/.
import {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  markNotificationReadFn,
  markAllNotificationsReadFn,
  dismissNotificationFn,
} from '#/contexts/notification/server/notifications'
import type { NotificationServerFns } from '#/components/features/notification/types'

export const notificationFns: NotificationServerFns = {
  getUnreadCount: getUnreadNotificationCountFn,
  getList: getNotificationsFn,
  markRead: markNotificationReadFn,
  markAllRead: markAllNotificationsReadFn,
  dismiss: dismissNotificationFn,
}
