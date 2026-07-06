// Inbox state hook — data fetching for the inbox list.
// Receives the getInboxItems server fn as a param per src/components/CONTEXT.md:55.
// Pure appliers + navigation sub-hook live in inbox-state-helpers.ts.
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import type { getInboxItemsFn } from '#/contexts/inbox/server/inbox'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type {
  InboxItem,
  InboxStatus,
  Cursor,
} from '#/contexts/inbox/application/public-api'
import { INBOX_PAGE_SIZE } from '#/components/inbox/inbox-search-schema'
import {
  applyLoadedPage,
  applyLoadError,
  isSelectedItemMissing,
  useInboxNavigation,
  type InboxNavigate,
} from './inbox-state-helpers'

export function useInboxState(
  orgId: string | undefined,
  filters: InboxFilterValues,
  selectedId: string | undefined,
  onNavigate: InboxNavigate,
  getInboxItems: typeof getInboxItemsFn,
) {
  const [items, setItems] = useState<ReadonlyArray<InboxItem>>([])
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([])

  const loadAction = useAction(useServerFn(getInboxItems))
  // One ref holds both the request-id counter and the live action handle so
  // loadItems reads fresh values without re-creating its callback each render.
  const stateRef = useRef({ requestId: 0, action: loadAction })
  stateRef.current.action = loadAction

  const { handleRowClick, closeDetail } = useInboxNavigation(onNavigate)

  const loadItems = useCallback(
    async (cursor?: Cursor) => {
      if (!orgId) return
      const requestId = ++stateRef.current.requestId
      if (!cursor) setIsLoading(true)
      setError(null)
      try {
        const r = await stateRef.current.action({
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
        if (requestId === stateRef.current.requestId) {
          applyLoadedPage(r, cursor, setItems, setNextCursor)
        }
      } catch {
        if (requestId === stateRef.current.requestId) {
          applyLoadError(cursor, setItems, setError)
        }
      } finally {
        if (requestId === stateRef.current.requestId) setIsLoading(false)
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
    if (isSelectedItemMissing(selectedId, isLoading, items))
      onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: undefined }) })
  }, [selectedId, items, isLoading, onNavigate])

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
