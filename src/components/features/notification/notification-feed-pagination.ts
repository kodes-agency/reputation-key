import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  isNewerFeedPosition,
  type NotificationFeedCursor,
  type NotificationFeedHead,
  type NotificationView,
  type NotificationPage,
} from '#/contexts/feed/application/public-api'

export const NOTIFICATION_POLL_INTERVAL = 30_000

/** Visibility/focus posture for the unified badge + feed-head snapshot. */
export const NOTIFICATION_POLL_OPTIONS = {
  refetchInterval: NOTIFICATION_POLL_INTERVAL,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const

type FetchNotificationPage = (
  before: NotificationFeedCursor | null,
) => Promise<NotificationPage>
type FetchNotificationFeedHead = () => Promise<NotificationFeedHead>

/** Loaded history as the query cache holds it: each page and the cursor it continued from. */
export type NotificationHistoryPages = Readonly<{
  pages: ReadonlyArray<NotificationPage>
  pageParams: ReadonlyArray<NotificationFeedCursor | null>
}>

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
 *
 * Pages are keyset pages. The first continues strictly after the head's last
 * row (`headCursor`), each later one after the previous page's last row, so a
 * row arriving or leaving above a page can neither shift it nor make the next
 * "Load more" skip a row.
 */
export function notificationHistoryQueryOptions(
  queryKey: QueryKey,
  fetchPage: FetchNotificationPage,
  headCursor: NotificationFeedCursor | null,
) {
  return {
    queryKey,
    queryFn: ({ pageParam }: { pageParam: NotificationFeedCursor | null }) =>
      fetchPage(pageParam),
    initialPageParam: headCursor,
    getNextPageParam: (lastPage: NotificationPage) =>
      lastPage.hasMore ? lastPage.nextCursor : null,
    enabled: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  } as const
}

/**
 * True when a refreshed head no longer reaches the first loaded history page.
 * The head is a bounded page: rows arriving above it, or a coalesced row
 * re-sorting to the top, push rows out of it, and those rows are then in
 * neither cache. A head that only shrank still overlaps history.
 */
function isHistoryDetached(
  head: NotificationPage,
  historyStart: NotificationFeedCursor | null | undefined,
): boolean {
  if (!historyStart || !head.hasMore || !head.nextCursor) return false
  return isNewerFeedPosition(head.nextCursor, historyStart)
}

/**
 * The head fetch, keeping loaded history contiguous with it. When a refreshed
 * head no longer reaches loaded history, that history is reset, so the list
 * shows the head alone and "Load more" continues from the head's own cursor
 * rather than leaving a silent gap in the middle of the list.
 */
export function fetchHeadKeepingHistoryContiguous(
  qc: QueryClient,
  historyKey: QueryKey,
  fetchHead: FetchNotificationFeedHead,
): FetchNotificationFeedHead {
  return async () => {
    const head = await fetchHead()
    const history = qc.getQueryData<NotificationHistoryPages>(historyKey)
    if (history && isHistoryDetached(head.page, history.pageParams[0])) {
      await qc.resetQueries({ queryKey: historyKey, exact: true })
    }
    return head
  }
}

/**
 * The refreshed head wins for an overlapping id, while every older row that
 * the user already loaded remains visible exactly once.
 */
export function mergeNotificationHeadWithHistory(
  head: NotificationPage | undefined,
  historyPages: ReadonlyArray<NotificationPage> = [],
): ReadonlyArray<NotificationView> {
  const notifications: NotificationView[] = []
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
