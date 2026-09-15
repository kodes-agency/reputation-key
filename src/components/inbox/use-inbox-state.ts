// Inbox list state — cursor-paginated list backed by TanStack Query.
// Receives the getInboxItems server fn as a param per src/components/CONTEXT.md "Server-function boundary".
// useInfiniteQuery owns fetch/cache/race-cancellation; filter changes are debounced
// into the query key (300ms) so typing doesn't refetch per keystroke. Optimistic
// status updates + bulk reload use setQueryData / invalidateQueries (targeted,
// never router.invalidate()). Navigation sub-hook lives in inbox-state-helpers.
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type {
  InboxItem,
  Cursor,
  InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { INBOX_PAGE_SIZE } from '#/components/inbox/inbox-search-schema'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  selectedItemPresenceAction,
  useInboxNavigation,
  useSelectedItemDeparture,
  type InboxNavigate,
  type SelectedItemDeparture,
} from './inbox-state-helpers'
import { reconcileInboxPageItems, removeInboxSelection } from './inbox-selection'
import { itemMatchesQueue } from './inbox-queues'
import { useDebouncedValue } from './use-debounced-value'
import { useScopedInboxSelection } from './use-scoped-inbox-selection'
import {
  inboxCachePolicy,
  inboxListPagesRefetchInterval,
  isReplyPolled,
} from './inbox-cache-policy'

type InboxPage = {
  items: ReadonlyArray<InboxItem>
  nextCursor: Cursor | null
  totalCount: number
  responseCutoff: Date
  viewedUpTo: Date | null
}

type ReplyPollObservation = Readonly<{
  organizationId: string | undefined
  filters: InboxFilterValues
  polledItemIds: ReadonlySet<string>
}>

function useViewedUpToLatch(
  organizationId: string | undefined,
  pageViewedUpTo: Date | null | undefined,
): Date | null {
  const [latch, setLatch] = useState<{
    organizationId: string | undefined
    value: Date | null | undefined
  }>({ organizationId: undefined, value: undefined })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first successful server page is an external watermark snapshot; latch it once so the visit mutation cannot erase row dots
    setLatch((current) => {
      if (current.organizationId !== organizationId) {
        return { organizationId, value: pageViewedUpTo }
      }
      if (current.value !== undefined || pageViewedUpTo === undefined) return current
      return { organizationId, value: pageViewedUpTo }
    })
  }, [organizationId, pageViewedUpTo])

  return latch.organizationId === organizationId ? (latch.value ?? null) : null
}

function useReplySettlementInvalidation(
  organizationId: string | undefined,
  filters: InboxFilterValues,
  items: ReadonlyArray<InboxItem>,
  queryClient: QueryClient,
): void {
  const observation = useRef<ReplyPollObservation | null>(null)

  useEffect(() => {
    const polledItemIds = new Set<string>()
    for (const item of items) {
      if (isReplyPolled(item.replyState)) polledItemIds.add(item.id)
    }
    const previous = observation.current
    const sameScope =
      previous !== null &&
      previous.organizationId === organizationId &&
      previous.filters === filters
    if (sameScope) {
      for (const id of previous.polledItemIds) {
        if (!polledItemIds.has(id)) {
          inboxCachePolicy.onListReplySettled(queryClient)
          break
        }
      }
    }
    observation.current = { organizationId, filters, polledItemIds }
  }, [filters, items, organizationId, queryClient])
}

function useSelectedItemPresence(
  qc: QueryClient,
  selectedId: string | undefined,
  items: ReadonlyArray<InboxItem>,
  isPending: boolean,
  onNavigate: InboxNavigate,
  departure: SelectedItemDeparture,
): void {
  const seenSelectedId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const action = selectedItemPresenceAction(
      seenSelectedId.current,
      selectedId,
      isPending,
      items,
      departure,
    )
    if (action === 'reset') seenSelectedId.current = undefined
    if (action === 'remember') seenSelectedId.current = selectedId
    // The re-read's own cache update re-runs this effect with a fresh answer:
    // `fetching` keeps the pane meanwhile, so it is issued once.
    if (action === 'refresh' && selectedId) {
      void qc.refetchQueries({ queryKey: inboxKeys.detail(selectedId), exact: true })
    }
    if (action === 'close') {
      seenSelectedId.current = undefined
      onNavigate({ to: '.', search: (previous) => ({ ...previous, itemId: undefined }) })
    }
  }, [qc, selectedId, items, isPending, onNavigate, departure])
}

export function useInboxState(
  orgId: string | undefined,
  queue: InboxQueue,
  viewerId: string | undefined,
  filters: InboxFilterValues,
  selectedId: string | undefined,
  onNavigate: InboxNavigate,
  getInboxItems: typeof getInboxItemsFn,
) {
  const qc = useQueryClient()
  const { selectedIds, setSelectedIds } = useScopedInboxSelection(orgId, queue, filters)
  const { handleRowClick, closeDetail } = useInboxNavigation(onNavigate)

  // Debounce the filters used for BOTH the query key and the fetch args, so the
  // list refetches once 300ms after the user stops typing — not per keystroke.
  const debouncedFilters = useDebouncedValue(filters, 300)

  const query = useInfiniteQuery({
    queryKey: inboxKeys.list({ queue, ...debouncedFilters }),
    queryFn: ({ pageParam }) =>
      getInboxItems({
        data: {
          ...debouncedFilters,
          queue,
          cursor: pageParam ? btoa(JSON.stringify(pageParam)) : undefined,
          limit: INBOX_PAGE_SIZE,
        },
      }),
    initialPageParam: undefined as Cursor | undefined,
    getNextPageParam: (last: InboxPage) => last.nextCursor ?? undefined,
    enabled: !!orgId,
    refetchInterval: (activeQuery) =>
      inboxListPagesRefetchInterval(activeQuery.state.data?.pages),
  })

  const pages = query.data?.pages
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages])
  const pageViewedUpTo = pages?.[0]?.viewedUpTo
  const viewedUpTo = useViewedUpToLatch(orgId, pageViewedUpTo)

  // A polled row can disappear because provider confirmation closed it, or it
  // can remain in the folder with a terminal outcome. Either transition makes
  // the summary badges stale. Scope identity prevents filter/org changes from
  // being mistaken for settlement.
  useReplySettlementInvalidation(orgId, debouncedFilters, items, qc)
  const nextCursor = pages?.length ? pages[pages.length - 1]!.nextCursor : null
  const totalCount = pages?.[0]?.totalCount ?? 0
  const responseCutoff = pages?.[0]?.responseCutoff ?? null

  // Close only an item that was visible and then left this queue. A direct
  // itemId may legitimately name an item outside the queue and loads detail
  // through its independently authorized query. An open item whose own reply
  // moved it to another reply queue stays open (D8, `selectedItemDeparture`).
  const departure = useSelectedItemDeparture(qc, queue, selectedId, query.dataUpdatedAt)
  useSelectedItemPresence(qc, selectedId, items, query.isPending, onNavigate, departure)

  // Optimistic in-place patch after a detail status change (mark-read / escalate /
  // archive): update the item across all loaded pages, or drop it if its new
  // status no longer matches the active filter. Replaces the old setItems callback.
  const patchItem = useCallback(
    (u: InboxItem) => {
      const visible = itemMatchesQueue(u, queue, viewerId)
      if (!visible) {
        setSelectedIds((previous) => removeInboxSelection(previous, u.id))
      }
      qc.setQueryData(inboxKeys.list({ queue, ...debouncedFilters }), (old: unknown) => {
        if (!old || typeof old !== 'object' || !('pages' in old)) return old
        const data = old as { pages: InboxPage[]; pageParams: unknown[] }
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: reconcileInboxPageItems(p.items, u, visible),
          })),
        }
      })
    },
    [qc, queue, viewerId, debouncedFilters, setSelectedIds],
  )

  // Bulk update → clear selection, refetch the list (targeted), close detail.
  const handleBulkDone = useCallback(() => {
    setSelectedIds([])
    inboxCachePolicy.onBulkReopened(qc)
    if (selectedId) closeDetail()
  }, [selectedId, qc, closeDetail, setSelectedIds])

  return {
    items,
    totalCount,
    nextCursor,
    hasLoadedSuccessfully: query.isSuccess && query.isFetchedAfterMount,
    responseCutoff,
    viewedUpTo,
    isLoading: query.isPending,
    error: query.error ? 'Failed to load inbox. Try again.' : null,
    selectedIds,
    setSelectedIds,
    // LoadMoreButton compat: nextCursor (has-more) + a loadAction-shaped pending flag.
    loadAction: { isPending: query.isFetchingNextPage },
    loadMore: async () => {
      await query.fetchNextPage()
    },
    refetch: () => {
      void query.refetch()
    },
    patchItem,
    handleRowClick,
    closeDetail,
    handleBulkDone,
  }
}
