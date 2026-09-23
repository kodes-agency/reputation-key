import {
  InfiniteQueryObserver,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import type {
  NotificationFeedHead,
  NotificationListFilter,
  NotificationPage,
} from '#/contexts/feed/application/public-api'
import { notificationKeys } from '#/shared/queries/query-keys'
import { matchesNotificationFilter } from './notification-filters'
import type { NotificationHistoryPages } from './notification-feed-pagination'
import {
  patchedCounts,
  uniqueRows,
  unreadDeltaWithin,
  type ClearedUnread,
  type RowPatch,
} from './notification-feed-counts'

type FeedPages = NotificationHistoryPages
type CachedFeed = NotificationFeedHead | FeedPages

function patchPage(page: NotificationPage, patch: RowPatch): NotificationPage {
  const notifications = page.notifications.flatMap((row) => {
    const patched = patch(row)
    return patched ? [patched] : []
  })
  return { ...page, notifications }
}

/** `clearContinuation` pins `hasMore` off so a drained feed stops paginating. */
function patchCachedPage(
  page: NotificationPage,
  patch: RowPatch,
  clearContinuation: boolean | undefined,
): NotificationPage {
  const patched = patchPage(page, patch)
  return clearContinuation ? { ...patched, hasMore: false } : patched
}

const isHistory = (data: CachedFeed): data is FeedPages => 'pages' in data
const pagesOf = (data: CachedFeed): ReadonlyArray<NotificationPage> =>
  isHistory(data) ? data.pages : [data.page]

/** The filter a feed key was read under: `list(org, limit, filter)`, and its head. */
function filterOf(queryKey: QueryKey): NotificationListFilter {
  const identity = queryKey.find(
    (part): part is Readonly<{ filter: NotificationListFilter }> =>
      typeof part === 'object' && part !== null && 'filter' in part,
  )
  return identity?.filter ?? 'all'
}

/** The patch as one cache sees it: a changed row that left its filter leaves it. */
function patchWithin(filter: NotificationListFilter, patch: RowPatch): RowPatch {
  return (row) => {
    const patched = patch(row)
    if (patched === null || patched === row) return patched
    return matchesNotificationFilter(patched, filter) ? patched : null
  }
}

/** A "Load more" in flight: the only fetch a disabled history query makes once it has pages. */
const isLoadingMore = (query: Query) =>
  query.state.data !== undefined &&
  query.state.fetchStatus === 'fetching' &&
  query.state.fetchMeta?.fetchMore?.direction === 'forward'

/** Asks for the next page again through the list that asked for it, if it is still shown. */
function resumeLoadMore(query: Query): void {
  const list = query.observers.find(
    (observer): observer is InfiniteQueryObserver =>
      observer instanceof InfiniteQueryObserver,
  )
  void list?.fetchNextPage()
}

type CachedEntry = Readonly<{ key: QueryKey; data: CachedFeed }>

/**
 * What a filter-wide write cleared: the unread rows its filter held, read from
 * that filter's own cached head, else from the loaded rows alone.
 */
function clearedUnreadOf(
  filter: NotificationListFilter,
  heads: ReadonlyArray<CachedEntry>,
  delta: (filter: NotificationListFilter) => number,
): ClearedUnread {
  const held = heads.flatMap(({ key, data }) =>
    !isHistory(data) && filterOf(key) === filter ? [data.filterUnreadCount] : [],
  )
  return { filter, held: held.length > 0 ? Math.max(...held) : -delta(filter) }
}

/**
 * Optimistically patch every cached feed of the Organization: the bell's and
 * the page's heads and loaded history pages, for every filter. Patching only
 * the surface that acted left the other one's history (disabled, so never
 * refetched) showing rows the server had already changed. The counts move by
 * the de-duplicated union of every cached row, so a row held by several
 * caches (a head/history boundary, or the bell and the page) counts once. The
 * returned thunk restores every touched cache on failure.
 *
 * `clearsUnreadOf` names the filter whose every unread row the write clears
 * ("Mark all read" on that tab; `all` for "Dismiss all"): rows no one loaded
 * change too, so the counts move by that filter's own count instead.
 */
export function patchNotificationFeedCache(
  qc: QueryClient,
  organizationId: string,
  patch: RowPatch,
  options: Readonly<{
    clearContinuation?: boolean
    clearsUnreadOf?: NotificationListFilter
  }> = {},
): (() => void) | undefined {
  // A read already in flight (opening the bell starts one, and so does every
  // poll) answers with the feed from before this write, and would land on top
  // of it: the badge would go 5 → 0 → 5 → 0. Cancelling reverts that query to
  // its last settled data synchronously, so the patch below applies to it, and
  // the success invalidation reads the server again afterwards. A query with
  // no data yet has nothing to protect and keeps its first read.
  //
  // History is disabled, so the invalidation never reads it again: a "Load
  // more" cancelled here would be silently dropped. It is asked for again once
  // the patch is in, and continues from the patched pages.
  const loadingMore = qc.getQueryCache().findAll({
    queryKey: notificationKeys.lists(organizationId),
    predicate: isLoadingMore,
  })
  void qc.cancelQueries({
    queryKey: notificationKeys.feed(organizationId),
    predicate: (query) => query.state.data !== undefined,
  })
  const previous = qc
    .getQueriesData<CachedFeed>({ queryKey: notificationKeys.lists(organizationId) })
    .flatMap(([key, data]) => (data ? [{ key, data }] : []))
  if (previous.length === 0) return undefined

  // Heads first: the freshest copy of a row decides its delta.
  const heads = previous.filter((entry) => !isHistory(entry.data))
  const histories = previous.filter((entry) => isHistory(entry.data))
  const loaded = uniqueRows(
    [...heads, ...histories].flatMap((entry) =>
      pagesOf(entry.data).flatMap((page) => page.notifications),
    ),
  )
  const delta = (filter: NotificationListFilter) =>
    unreadDeltaWithin(loaded, patch, filter)
  const cleared =
    options.clearsUnreadOf && clearedUnreadOf(options.clearsUnreadOf, heads, delta)

  for (const { key, data } of previous) {
    const within = patchWithin(filterOf(key), patch)
    const patchOne = (page: NotificationPage) =>
      patchCachedPage(page, within, options.clearContinuation)
    if (isHistory(data)) {
      qc.setQueryData<FeedPages>(key, { ...data, pages: data.pages.map(patchOne) })
      continue
    }
    qc.setQueryData<NotificationFeedHead>(key, {
      ...data,
      page: patchOne(data.page),
      ...patchedCounts(data, filterOf(key), delta, cleared),
    })
  }
  for (const query of loadingMore) resumeLoadMore(query)
  return () => {
    for (const { key, data } of previous) qc.setQueryData(key, data)
  }
}
