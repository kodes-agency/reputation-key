import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxSearchParams } from '#/components/inbox/inbox-page'
import type { InboxItem, Cursor } from '#/contexts/inbox/application/public-api'
import { INBOX_PAGE_SIZE } from '#/components/inbox/inbox-page'

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
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])

  const loadAction = useAction(useServerFn(getInboxItemsFn))
  const abortRef = useRef(false)
  const loadActionRef = useRef(loadAction)
  loadActionRef.current = loadAction

  const loadItems = useCallback(
    async (cursor?: Cursor) => {
      if (!orgId) return
      abortRef.current = false
      if (!cursor) setIsLoading(true)
      try {
        const r = await loadActionRef.current({
          data: {
            ...filters,
            cursor: cursor ? btoa(JSON.stringify(cursor)) : undefined,
            limit: INBOX_PAGE_SIZE,
          },
        })
        if (!abortRef.current) {
          const ni = r.items ?? []
          if (cursor) setItems((p) => [...p, ...ni])
          else setItems(ni)
          setNextCursor(r.nextCursor ?? null)
        }
      } catch {
        /* */
      } finally {
        if (!abortRef.current) setIsLoading(false)
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
    ],
  )

  useEffect(() => {
    loadItems()
    return () => {
      abortRef.current = true
    }
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
  const handleBulkDone = () => {
    setSelectedIds([])
    void loadItems()
    if (selectedId) closeDetail()
  }

  return {
    items,
    setItems,
    nextCursor,
    isLoading,
    selectedIds,
    setSelectedIds,
    loadAction,
    loadItems,
    handleRowClick,
    closeDetail,
    handleBulkDone,
  }
}
