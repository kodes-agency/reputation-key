// Aggregated type of the notification server fns the notification surfaces
// consume. Routes construct the bundle and pass it as `notificationFns`; the
// hooks in notification-queries receive the relevant fn and wrap it internally.
// Type-only imports (typeof prop typing) — allowed by the boundary gate.
import type {
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
import type { Notification } from '#/contexts/notification/application/public-api'

export type NotificationServerFns = Readonly<{
  getUnreadCount: typeof getUnreadNotificationCountFn
  getList: typeof getNotificationsFn
  markRead: typeof markNotificationReadFn
  markUnread: typeof markNotificationUnreadFn
  markAllRead: typeof markAllNotificationsReadFn
  dismiss: typeof dismissNotificationFn
  dismissAll: typeof dismissAllNotificationsFn
  /**
   * Preferences are read only when the user actually picks "Mute …" from a
   * row's overflow menu (via `ensureQueryData`), so the bell costs no extra
   * request. Muting needs the whole preference row because the update DTO is
   * a full replace, not a patch.
   */
  getPreferences: typeof getNotificationPreferencesFn
  updatePreference: typeof updateNotificationPreferenceFn
  /** Supplies the persisted `locale` + `timezone` used to format timestamps. */
  getUserSettings: typeof getNotificationUserSettingsFn
}>

/**
 * Every mutation a row can trigger. Bundled so the row, the popover and the
 * page all take one prop instead of six, and so stories can hand over `fn()`
 * spies in a single object.
 */
export type NotificationRowActions = Readonly<{
  /** Deep-link followed: mark read (if unread) and dismiss any open surface. */
  onActivate: (notification: Notification) => void
  onMarkRead: (notificationId: string) => void
  onMarkUnread: (notificationId: string) => void
  onDismiss: (notificationId: string) => void
  /** Disables the in-app channel for this row's category on this property. */
  onMuteCategory: (notification: Notification) => void
}>
