// Constructs the NotificationServerFns bundle from raw server fn references.
// Routes are the sanctioned site for importing server fns (CONTEXT.md:55);
// components receive this bundle as a prop and never value-import server/.
import {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  markNotificationReadFn,
  markNotificationUnreadFn,
  markAllNotificationsReadFn,
  dismissNotificationFn,
  dismissAllNotificationsFn,
  getNotificationPreferencesFn,
  updateNotificationPreferenceFn,
  getNotificationUserSettingsFn,
} from '#/contexts/notification/server/notifications'
import type { NotificationServerFns } from '#/components/features/notification/types'

export const notificationFns: NotificationServerFns = {
  getUnreadCount: getUnreadNotificationCountFn,
  getList: getNotificationsFn,
  markRead: markNotificationReadFn,
  markUnread: markNotificationUnreadFn,
  markAllRead: markAllNotificationsReadFn,
  dismiss: dismissNotificationFn,
  dismissAll: dismissAllNotificationsFn,
  getPreferences: getNotificationPreferencesFn,
  updatePreference: updateNotificationPreferenceFn,
  getUserSettings: getNotificationUserSettingsFn,
}
