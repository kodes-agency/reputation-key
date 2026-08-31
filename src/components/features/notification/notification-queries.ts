// Notification READS — TanStack Query. Mutations live in notification-mutations.ts.
//
// The badge count and list head are one snapshot and one polling query.
// Previously the infinite list itself carried the interval, so TanStack Query
// correctly re-requested every
// loaded page to keep an infinite query consistent. That made a long-lived
// notification page progressively more expensive. Page zero now has its own
// ordinary query; loaded history is a disabled infinite query advanced only by
// the user's "Load more" action. The two caches are merged by stable row id.
//
// Polling is VISIBILITY-AWARE, using the query library's own primitives rather
// than a hand-rolled `visibilitychange` listener (@tanstack/react-query 5.101):
//
//   - `refetchIntervalInBackground: false` — the interval tick only calls
//     through to a fetch when `focusManager.isFocused()`
//     (queryObserver.ts#updateRefetchInterval). In v5 the focus manager listens
//     to `visibilitychange` ONLY, and `isFocused()` is literally
//     `document.visibilityState !== 'hidden'`, so this is exactly the
//     "don't poll a hidden tab" semantics we want. It is the library default,
//     but it is stated here because it is the load-bearing option: flipping it
//     to `true` silently restores background polling for every logged-in tab.
//   - `refetchOnWindowFocus: true` + `staleTime: 0` — coming back to the tab
//     fires `queryCache.onFocus()` → `query.onFocus()` → an immediate refetch,
//     so the badge is correct on return instead of up to 30s stale.
//
// Deliberately NOT a push transport: SSE/websockets would need Redis fan-out
// across replicas to be correct, and 30s polling is not the bottleneck today.

import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import {
  DEFAULT_NOTIFICATION_FORMAT,
  type NotificationFormat,
} from './notification-utils'
import {
  mergeNotificationHeadWithHistory,
  notificationHeadQueryOptions,
  notificationHistoryQueryOptions,
} from './notification-feed-pagination'
import type {
  getNotificationFeedHeadFn,
  getNotificationsFn,
  getNotificationUserSettingsFn,
} from '#/contexts/notification/server/notifications'
import type { NotificationListFilter } from '#/contexts/notification/application/public-api'

export function useNotifications(
  getFeedHead: typeof getNotificationFeedHeadFn,
  getList: typeof getNotificationsFn,
  organizationId: string,
  limit = 20,
  filter: NotificationListFilter = 'all',
  poll = false,
) {
  const fetchPage = (offset: number) => getList({ data: { limit, offset, filter } })
  const fetchHead = () => getFeedHead({ data: { limit, filter } })
  const head = useQuery(
    notificationHeadQueryOptions(
      notificationKeys.head(organizationId, limit, filter),
      fetchHead,
      poll,
    ),
  )
  const history = useInfiniteQuery(
    notificationHistoryQueryOptions(
      notificationKeys.list(organizationId, limit, filter),
      fetchPage,
      limit,
    ),
  )
  const historyPages = history.data?.pages ?? []
  const hasLoadedHistory = historyPages.length > 0
  const hasMore = hasLoadedHistory
    ? history.hasNextPage
    : (head.data?.page.hasMore ?? false)

  return {
    notifications: mergeNotificationHeadWithHistory(head.data?.page, historyPages),
    unreadCount: head.data?.unreadCount ?? 0,
    watermark: head.data?.watermark ?? null,
    isLoading: head.isPending,
    isLoadingMore: history.isFetchingNextPage,
    error: head.error ?? history.error,
    hasMore,
    refetch: () => {
      void head.refetch()
      if (history.isFetchNextPageError) void history.fetchNextPage()
    },
    loadMore: () => {
      if (hasMore && !history.isFetchingNextPage) void history.fetchNextPage()
    },
  }
}

/**
 * The user's persisted locale + IANA timezone, used to format every timestamp.
 * The settings page advertises these as "used for notification formatting", so
 * the feed honours them instead of the old hardcoded `'en-US'`.
 *
 * Shares `notificationKeys.userSettings` with the settings page, so visiting
 * either surface warms the other. Falls back to a FIXED default (not the
 * browser's) so the server render and the first client render agree.
 */
export function useNotificationFormat(
  getUserSettings: typeof getNotificationUserSettingsFn,
  organizationId: string,
): NotificationFormat {
  const query = useQuery({
    queryKey: notificationKeys.userSettings(organizationId),
    queryFn: () => getUserSettings(),
    staleTime: 60_000,
  })
  const settings = query.data
  if (!settings) return DEFAULT_NOTIFICATION_FORMAT
  return { locale: settings.locale, timeZone: settings.timezone }
}
