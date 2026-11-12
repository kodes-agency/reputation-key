// Notification READS — TanStack Query. Mutations live in notification-mutations.ts.
//
// One polled head and one cursor list below it. The head (the first page, the
// badge count and the filter's share, from one database snapshot) is the only
// read on a timer. Older rows are read only on "Load more", strictly after the
// head's last row, and are re-read to the depth loaded only when a head read
// shows they no longer continue it (notification-feed-older.ts). Writes in
// flight are applied over both at render (notification-feed-writes.ts).
//
// Polling is VISIBILITY-AWARE, using the query library's own primitives rather
// than a hand-rolled `visibilitychange` listener (@tanstack/react-query 5.103):
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

import { useMemo } from 'react'
import {
  skipToken,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import type { TenantScope } from '#/shared/queries/tenant-scope'
import {
  DEFAULT_NOTIFICATION_FORMAT,
  type NotificationFormat,
} from './notification-utils'
import {
  notificationHeadQueryOptions,
  readHeadKeepingOlderTrue,
} from './notification-feed-head'
import {
  loadOlderNotifications,
  mergeNotificationRows,
  type FetchNotificationPage,
  type OlderNotifications,
} from './notification-feed-older'
import {
  feedWritesKey,
  pendingFeedWrite,
  withPendingWrites,
} from './notification-feed-writes'
import type {
  getNotificationFeedHeadFn,
  getNotificationsFn,
  getNotificationUserSettingsFn,
} from '#/contexts/feed/server/notifications'
import type { NotificationListFilter } from '#/contexts/feed/application/public-api'

export function useNotifications(
  tenantScope: TenantScope,
  getFeedHead: typeof getNotificationFeedHeadFn,
  getList: typeof getNotificationsFn,
  organizationId: string,
  limit = 20,
  filter: NotificationListFilter = 'all',
  poll = false,
  /** The page's Property filter; absent reads the whole feed. */
  propertyId?: string,
) {
  const { notificationKeys } = createKeys(tenantScope)
  const qc = useQueryClient()
  const olderKey = notificationKeys.list(organizationId, limit, filter, propertyId)
  const headKey = notificationKeys.head(organizationId, limit, filter, propertyId)
  const scope = propertyId ? { propertyId } : {}
  const fetchPage: FetchNotificationPage = (before, pageLimit) =>
    getList({ data: { limit: pageLimit, filter, ...scope, before } })
  const fetchHead = readHeadKeepingOlderTrue(
    qc,
    olderKey,
    () => getFeedHead({ data: { limit, filter, ...scope } }),
    fetchPage,
    limit,
  )
  const head = useQuery(notificationHeadQueryOptions(headKey, fetchHead, poll))
  // Written only by Load more and by head reads; never fetched on its own.
  const older =
    useQuery<OlderNotifications | null>({
      queryKey: olderKey,
      queryFn: skipToken,
      staleTime: Infinity,
    }).data ?? null
  const writes = useMutationState({
    filters: {
      mutationKey: feedWritesKey(tenantScope, organizationId),
      status: 'pending',
    },
    select: pendingFeedWrite,
  })

  const { userId, organizationId: scopeOrganizationId } = tenantScope
  const view = useMemo(
    () =>
      withPendingWrites(
        qc,
        { userId, organizationId: scopeOrganizationId },
        organizationId,
        { filter, propertyId },
        {
          rows: mergeNotificationRows(head.data?.page, older?.rows),
          unreadCount: head.data?.unreadCount ?? 0,
          filterUnreadCount: head.data?.filterUnreadCount ?? 0,
          hasMore: older ? older.nextCursor !== null : (head.data?.page.hasMore ?? false),
        },
        writes,
      ),
    [
      qc,
      userId,
      scopeOrganizationId,
      organizationId,
      filter,
      propertyId,
      head.data,
      older,
      writes,
    ],
  )
  const isLoadingMore = older?.isLoadingMore ?? false
  const loadMore = () =>
    void loadOlderNotifications(qc, olderKey, headKey, fetchPage, limit)

  return {
    notifications: view.rows,
    unreadCount: view.unreadCount,
    /** The unread rows this filter holds: what its "Mark all read" would change. */
    filterUnreadCount: view.filterUnreadCount,
    watermark: head.data?.watermark ?? null,
    // Placeholder data carries only the count; the rows are still loading.
    isLoading: head.isPending || head.isPlaceholderData,
    isLoadingMore,
    // Kept apart: a failed "Load more" must not hide the rows the head holds.
    error: head.error,
    loadMoreError: older?.loadMoreError ?? null,
    hasMore: view.hasMore,
    refetch: () => {
      void head.refetch()
      if (older?.loadMoreError) loadMore()
    },
    loadMore: () => {
      if (view.hasMore && !isLoadingMore) loadMore()
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
  tenantScope: TenantScope,
  getUserSettings: typeof getNotificationUserSettingsFn,
  organizationId: string,
): NotificationFormat {
  const { notificationKeys } = createKeys(tenantScope)
  const query = useQuery({
    queryKey: notificationKeys.userSettings(organizationId),
    queryFn: () => getUserSettings(),
    staleTime: 60_000,
  })
  const settings = query.data
  if (!settings) return DEFAULT_NOTIFICATION_FORMAT
  return { locale: settings.locale, timeZone: settings.timezone }
}
