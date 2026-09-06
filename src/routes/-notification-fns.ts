// Constructs the NotificationServerFns bundle from raw server fn references.
// Routes are the sanctioned site for importing server fns (CONTEXT.md:55);
// components receive this bundle as a prop and never value-import server/.
//
// WHY GETTERS AND NOT AN OBJECT LITERAL. See `_authenticated/-inbox-fns.ts` for
// the failure this shape prevents: that table captured its members eagerly,
// the client build put it in an import cycle with the chunk defining two of
// them, and ESM handed it `undefined` — which surfaced only as a rendered
// error state with no network request and nothing logged anywhere.
//
// This bundle sits in a cycle too (its chunk is transitively reachable from
// itself), and today's chunk order happens to resolve in its favour. That is
// luck, not a guarantee: it holds the whole notification feed and popover.
// Reading the binding at property-access time removes the dependence on
// evaluation order entirely.
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
} from '#/contexts/notification/server/notifications'
import type { NotificationServerFns } from '#/components/features/notification/types'

export const notificationFns: NotificationServerFns = {
  get getFeedHead() {
    return getNotificationFeedHeadFn
  },
  get getList() {
    return getNotificationsFn
  },
  get markRead() {
    return markNotificationReadFn
  },
  get markUnread() {
    return markNotificationUnreadFn
  },
  get markAllRead() {
    return markAllNotificationsReadFn
  },
  get dismiss() {
    return dismissNotificationFn
  },
  get dismissAll() {
    return dismissAllNotificationsFn
  },
  get muteCategory() {
    return muteNotificationCategoryFn
  },
  get getUserSettings() {
    return getNotificationUserSettingsFn
  },
}
