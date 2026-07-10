// Inbox list state — cursor-paginated list backed by TanStack Query.
// Receives the getInboxItems server fn as a param per src/components/CONTEXT.md:55.
// useInfiniteQuery owns fetch/cache/race-cancellation; filter changes are debounced
// into the query key (300ms) so typing doesn't refetch per keystroke. Optimistic
// status updates + bulk reload use setQueryData / invalidateQueries (targeted,
// never router.invalidate()). Navigation sub-hook lives in inbox-state-helpers.
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { useState, useEffect, useCallback } from 'react'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxItem, Cursor } from '#/contexts/inbox/application/public-api'
import { INBOX_PAGE_SIZE } from '#/components/inbox/inbox-search-schema'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  isSelectedItemMissing,
  useInboxNavigation,
  type InboxNavigate,
} from './inbox-state-helpers'

/** Debounce a value — used so the query key (and thus the fetch) only changes
 *  300ms after the user stops changing filters (matches the prior manual debounce). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

type InboxPage = { items: ReadonlyArray<InboxItem>; nextCursor: Cursor | null }

export function useInboxState(
  orgId: string | undefined,
  filters: InboxFilterValues,
  selectedId: string | undefined,
  onNavigate: InboxNavigate,
  getInboxItems: typeof getInboxItemsFn,
) {
  const qc = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])
  const { handleRowClick, closeDetail } = useInboxNavigation(onNavigate)

  // Debounce the filters used for BOTH the query key and the fetch args, so the
  // list refetches once 300ms after the user stops typing — not per keystroke.
  const debouncedFilters = useDebouncedValue(filters, 300)

  const query = useInfiniteQuery({
    queryKey: inboxKeys.list(debouncedFilters),
    queryFn: ({ pageParam }) =>
      getInboxItems({
        data: {
          ...debouncedFilters,
          status:
            debouncedFilters.status && typeof debouncedFilters.status !== 'string'
              ? ([...debouncedFilters.status] as InboxItem['status'][])
              : debouncedFilters.status,
          cursor: pageParam ? btoa(JSON.stringify(pageParam)) : undefined,
          limit: INBOX_PAGE_SIZE,
        },
      }),
    initialPageParam: undefined as Cursor | undefined,
    getNextPageParam: (last: InboxPage) => last.nextCursor ?? undefined,
    enabled: !!orgId,
  })

  const pages = query.data?.pages ?? []
  const items = pages.flatMap((p) => p.items)
  const nextCursor = pages.length ? pages[pages.length - 1]!.nextCursor : null

  // Clear selection when the (live) filters change — immediate, not debounced.
  useEffect(() => {
    setSelectedIds([])
  }, [
    filters.status,
    filters.sourceType,
    filters.platform,
    filters.ratingMin,
    filters.ratingMax,
    filters.propertyId,
    filters.q,
  ])

  // Auto-close the detail if the selected item is no longer in the loaded list.
  useEffect(() => {
    if (isSelectedItemMissing(selectedId, query.isPending, items))
      onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: undefined }) })
  }, [selectedId, items, query.isPending, onNavigate])

  // Optimistic in-place patch after a detail status change (mark-read / escalate /
  // archive): update the item across all loaded pages, or drop it if its new
  // status no longer matches the active filter. Replaces the old setItems callback.
  const patchItem = useCallback(
    (u: InboxItem) => {
      qc.setQueryData(inboxKeys.list(debouncedFilters), (old: unknown) => {
        if (!old || typeof old !== 'object' || !('pages' in old)) return old
        const data = old as { pages: InboxPage[]; pageParams: unknown[] }
        const visible = !debouncedFilters.status
          ? true
          : typeof debouncedFilters.status !== 'string'
            ? debouncedFilters.status.includes(u.status)
            : debouncedFilters.status === u.status
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: visible
              ? p.items.map((i) =>
                  i.id === u.id ? { ...i, status: u.status, updatedAt: u.updatedAt } : i,
                )
              : p.items.filter((i) => i.id !== u.id),
          })),
        }
      })
    },
    [qc, debouncedFilters],
  )

  // Bulk update → clear selection, refetch the list (targeted), close detail.
  const handleBulkDone = useCallback(() => {
    setSelectedIds([])
    qc.invalidateQueries({ queryKey: inboxKeys.lists() })
    qc.invalidateQueries({ queryKey: inboxKeys.counts() })
    qc.invalidateQueries({ queryKey: inboxKeys.newCount() })
    if (selectedId) closeDetail()
  }, [selectedId, qc, closeDetail])

  return {
    items,
    nextCursor,
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
