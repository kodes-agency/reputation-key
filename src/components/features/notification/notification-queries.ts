// Notification READS — TanStack Query. Mutations live in notification-mutations.ts.
//
// Both the badge count and the list poll. Previously only the count did, so an
// OPEN panel sat on a frozen list while the badge beside it kept climbing. The
// list polls only while its surface is actually visible (`poll`), so a closed
// bell costs one request per mount, not one every 30s.

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

export const NOTIFICATION_POLL_INTERVAL = 30_000

export function useUnreadNotificationCount(
  getUnreadCount: typeof getUnreadNotificationCountFn,
  organizationId: string,
) {
  const query = useQuery({
    queryKey: notificationKeys.count(organizationId),
    queryFn: () => getUnreadCount({ data: undefined }),
    refetchInterval: NOTIFICATION_POLL_INTERVAL,
    staleTime: 0,
  })
  return { count: query.data?.count ?? 0, isLoading: query.isLoading }
}

export function useNotifications(
  getList: typeof getNotificationsFn,
  organizationId: string,
  limit = 20,
  poll = false,
) {
  const query = useInfiniteQuery({
    queryKey: notificationKeys.list(organizationId, limit),
    queryFn: ({ pageParam }) => getList({ data: { limit, offset: pageParam } }),
    initialPageParam: 0,
    // If a full page came back, another page may exist → advance the offset.
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === limit ? lastPageParam + limit : undefined,
    refetchInterval: poll ? NOTIFICATION_POLL_INTERVAL : false,
    staleTime: 0,
  })

  return {
    notifications: query.data?.pages.flat() ?? [],
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
