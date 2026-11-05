import {
  getNotificationFeedHeadFn,
  getNotificationsFn,
  markNotificationReadFn,
  markNotificationUnreadFn,
  markAllNotificationsReadFn,
  dismissNotificationFn,
  dismissAllNotificationsFn,
  muteNotificationCategoryFn,
  getNotificationUserSettingsFn,
  restoreNotificationFn,
  undoNotificationCategoryMuteFn,
} from '#/contexts/feed/server/notifications'
import type { NotificationServerFns } from '#/components/features/notification/types'

export const notificationFns: NotificationServerFns = {
  getFeedHead: getNotificationFeedHeadFn,
  getList: getNotificationsFn,
  markRead: markNotificationReadFn,
  markUnread: markNotificationUnreadFn,
  markAllRead: markAllNotificationsReadFn,
  dismiss: dismissNotificationFn,
  dismissAll: dismissAllNotificationsFn,
  muteCategory: muteNotificationCategoryFn,
  restore: restoreNotificationFn,
  undoMuteCategory: undoNotificationCategoryMuteFn,
  getUserSettings: getNotificationUserSettingsFn,
}
