// Notification query hooks — TanStack Query (reads + polling) + silent mutations.
//
// Reads: useUnreadNotificationCount polls via Query's refetchInterval (replaces
// the manual setInterval); useNotifications paginates via useInfiniteQuery
// (replaces the manual offsetRef). Mutations stay on useMutationActionSilent but
// with invalidate:false — the panel does targeted notificationKeys invalidation
// (never router.invalidate()). See routes/CONTEXT.md (TanStack Query section).

import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import { notificationKeys } from '#/shared/queries/query-keys'
import type {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  markNotificationReadFn,
  markAllNotificationsReadFn,
  dismissNotificationFn,
  dismissAllNotificationsFn,
} from '#/contexts/notification/server/notifications'

// ── Polling unread count ────────────────────────────────────────────

const POLL_INTERVAL = 30_000

export function useUnreadNotificationCount(
  getUnreadCount: typeof getUnreadNotificationCountFn,
) {
  const query = useQuery({
    queryKey: notificationKeys.count(),
    queryFn: () => getUnreadCount({ data: undefined }),
    refetchInterval: POLL_INTERVAL,
    staleTime: 0,
  })
  return { count: query.data?.count ?? 0, isLoading: query.isLoading }
}

// ── Notification list (offset pagination) ───────────────────────────

export function useNotifications(getList: typeof getNotificationsFn, limit = 20) {
  const query = useInfiniteQuery({
    queryKey: notificationKeys.list(limit),
    queryFn: ({ pageParam }) => getList({ data: { limit, offset: pageParam } }),
    initialPageParam: 0,
    // If a full page came back, another page may exist → advance the offset.
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length === limit ? lastPageParam + limit : undefined,
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

// ── Mutations (silent; panel invalidates notificationKeys on success) ──

export function useMarkNotificationRead(markRead: typeof markNotificationReadFn) {
  return useMutationActionSilent(markRead, { invalidate: false })
}

export function useMarkAllNotificationsRead(
  markAllRead: typeof markAllNotificationsReadFn,
) {
  return useMutationActionSilent(markAllRead, { invalidate: false })
}

export function useDismissNotification(dismiss: typeof dismissNotificationFn) {
  return useMutationActionSilent(dismiss, { invalidate: false })
}

// ── Dismiss all notifications (Clear-all) ───────────────────────────

export function useDismissAllNotifications(dismissAll: typeof dismissAllNotificationsFn) {
  return useMutationActionSilent(dismissAll)
}
