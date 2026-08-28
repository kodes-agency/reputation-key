import type { QueryKey } from '@tanstack/react-query'
import type {
  NotificationFeedHead,
  Notification,
  NotificationPage,
} from '#/contexts/notification/application/public-api'

export const NOTIFICATION_POLL_INTERVAL = 30_000

/** Visibility/focus posture for the unified badge + feed-head snapshot. */
export const NOTIFICATION_POLL_OPTIONS = {
  refetchInterval: NOTIFICATION_POLL_INTERVAL,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const

type FetchNotificationPage = (offset: number) => Promise<NotificationPage>
type FetchNotificationFeedHead = () => Promise<NotificationFeedHead>

/** Query options for the only notification page allowed to refresh on a timer. */
export function notificationHeadQueryOptions(
  queryKey: QueryKey,
  fetchHead: FetchNotificationFeedHead,
  poll: boolean,
) {
  return {
    queryKey,
    queryFn: fetchHead,
    ...NOTIFICATION_POLL_OPTIONS,
    refetchInterval: poll ? NOTIFICATION_POLL_INTERVAL : false,
  } as const
}

/**
 * Older notification pages are fetched only on an explicit `fetchNextPage`.
 * Keeping this query disabled also prevents focus and feed invalidations from
 * replaying every page already in memory.
 */
export function notificationHistoryQueryOptions(
  queryKey: QueryKey,
  fetchPage: FetchNotificationPage,
  limit: number,
) {
  return {
    queryKey,
    queryFn: ({ pageParam }: { pageParam: number }) => fetchPage(pageParam),
    initialPageParam: limit,
    getNextPageParam: (
      lastPage: NotificationPage,
      _allPages: ReadonlyArray<NotificationPage>,
      lastPageParam: number,
    ) => (lastPage.hasMore ? lastPageParam + limit : undefined),
    enabled: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  } as const
}

/**
 * The refreshed head wins for an overlapping id, while every older row that
 * the user already loaded remains visible exactly once.
 */
export function mergeNotificationHeadWithHistory(
  head: NotificationPage | undefined,
  historyPages: ReadonlyArray<NotificationPage> = [],
): ReadonlyArray<Notification> {
  const notifications: Notification[] = []
  const seen = new Set<string>()

  for (const page of head ? [head, ...historyPages] : historyPages) {
    for (const notification of page.notifications) {
      if (seen.has(notification.id)) continue
      seen.add(notification.id)
      notifications.push(notification)
    }
  }

  return notifications
}
