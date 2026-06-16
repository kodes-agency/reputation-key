// Inbox state hook — data fetching for the inbox list.
//
// NOTE: Imports getInboxItemsFn from server/ per the CONTEXT.md exception
// for inbox-scoped data-fetching hooks. The hook is only used by the
// inbox page and its self-contained sub-tree.
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxSearchParams } from '#/components/inbox/inbox-search-schema'
import type {
  InboxItem,
  InboxStatus,
  Cursor,
} from '#/contexts/inbox/application/public-api'
import { INBOX_PAGE_SIZE } from '#/components/inbox/inbox-search-schema'

export function useInboxState(
  orgId: string | undefined,
  filters: InboxFilterValues,
  selectedId: string | undefined,
  onNavigate: (opts: {
    to: '.'
    search: (prev: InboxSearchParams) => Partial<InboxSearchParams>
  }) => void,
) {
  const [items, setItems] = useState<ReadonlyArray<InboxItem>>([])
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])

  const loadAction = useAction(useServerFn(getInboxItemsFn))
  const requestIdRef = useRef(0)
  const loadActionRef = useRef(loadAction)
  loadActionRef.current = loadAction

  const loadItems = useCallback(
    async (cursor?: Cursor) => {
      if (!orgId) return
      const requestId = ++requestIdRef.current
      if (!cursor) setIsLoading(true)
      setError(null)
      try {
        const r = await loadActionRef.current({
          data: {
            ...filters,
            status:
              filters.status && typeof filters.status !== 'string'
                ? ([...filters.status] as InboxStatus[])
                : filters.status,
            cursor: cursor ? btoa(JSON.stringify(cursor)) : undefined,
            limit: INBOX_PAGE_SIZE,
          },
        })
        if (requestId === requestIdRef.current) {
          const ni = r.items ?? []
          if (cursor) setItems((p) => [...p, ...ni])
          else setItems(ni)
          setNextCursor(r.nextCursor ?? null)
        }
      } catch {
        if (requestId === requestIdRef.current) {
          setError('Failed to load inbox items. Check your connection and try again.')
          if (!cursor) setItems([])
        }
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false)
      }
    },
    [
      orgId,
      filters.propertyId,
      filters.status,
      filters.sourceType,
      filters.platform,
      filters.ratingMin,
      filters.ratingMax,
      filters.q,
    ],
  )

  useEffect(() => {
    const t = setTimeout(() => loadItems(), 300)
    return () => clearTimeout(t)
  }, [loadItems])
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

  useEffect(() => {
    if (
      selectedId &&
      !isLoading &&
      items.length > 0 &&
      !items.some((i) => i.id === selectedId)
    )
      onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: undefined }) })
  }, [selectedId, items, isLoading, onNavigate])

  const handleRowClick = useCallback(
    (item: InboxItem) =>
      onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: item.id }) }),
    [onNavigate],
  )
  const closeDetail = useCallback(
    () => onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: undefined }) }),
    [onNavigate],
  )

  // FE-4 FIX: wrap handleBulkDone in useCallback
  const handleBulkDone = useCallback(() => {
    setSelectedIds([])
    void loadItems()
    if (selectedId) closeDetail()
  }, [selectedId, loadItems, closeDetail])

  return {
    items,
    setItems,
    nextCursor,
    isLoading,
    error,
    selectedIds,
    setSelectedIds,
    loadAction,
    loadItems,
    handleRowClick,
    closeDetail,
    handleBulkDone,
  }
}
