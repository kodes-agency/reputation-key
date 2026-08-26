// Notification READS — TanStack Query. Mutations live in notification-mutations.ts.
//
// Both the badge count and the list poll. Previously only the count did, so an
// OPEN panel sat on a frozen list while the badge beside it kept climbing. The
// list polls only while its surface is actually visible (`poll`), so a closed
// bell costs one request per mount, not one every 30s.
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
import type {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  getNotificationUserSettingsFn,
} from '#/contexts/notification/server/notifications'
import type { NotificationListFilter } from '#/contexts/notification/application/public-api'

export const NOTIFICATION_POLL_INTERVAL = 30_000

/**
 * The polling posture shared by both notification reads.
 *
 * Exported as one object so the two call sites cannot drift, and so the
 * behaviour is assertable against a real `QueryObserver` in
 * notification-queries.test.ts without rendering a component.
 */
export const NOTIFICATION_POLL_OPTIONS = {
  refetchInterval: NOTIFICATION_POLL_INTERVAL,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const

export function useUnreadNotificationCount(
  getUnreadCount: typeof getUnreadNotificationCountFn,
  organizationId: string,
) {
  const query = useQuery({
    queryKey: notificationKeys.count(organizationId),
    queryFn: () => getUnreadCount({ data: undefined }),
    ...NOTIFICATION_POLL_OPTIONS,
  })
  return { count: query.data?.count ?? 0, isLoading: query.isLoading }
}

export function useNotifications(
  getList: typeof getNotificationsFn,
  organizationId: string,
  limit = 20,
  filter: NotificationListFilter = 'all',
  poll = false,
) {
  const query = useInfiniteQuery({
    queryKey: notificationKeys.list(organizationId, limit, filter),
    queryFn: ({ pageParam }) => getList({ data: { limit, offset: pageParam, filter } }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + limit : undefined,
    ...NOTIFICATION_POLL_OPTIONS,
    refetchInterval: poll ? NOTIFICATION_POLL_INTERVAL : false,
  })

  return {
    notifications: query.data?.pages.flatMap((page) => page.notifications) ?? [],
    isLoading: query.isPending,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error,
    hasMore: query.hasNextPage,
    refetch: () => {
      void query.refetch()
    },
    loadMore: () => {
      void query.fetchNextPage()
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
