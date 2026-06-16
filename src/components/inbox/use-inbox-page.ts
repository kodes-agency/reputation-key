// Inbox page state hook — extracted from inbox-page-v2 for line-limit compliance.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxSearchParams } from './inbox-search-schema'
import { folderToStatus } from './inbox-search-schema'

export type InboxPageNav = (o: {
  to: '.'
  search: (p: InboxSearchParams) => Partial<InboxSearchParams>
}) => void

export function useIsMobile() {
  const [m, set] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 767px)')
    set(q.matches)
    const h = (e: MediaQueryListEvent) => set(e.matches)
    q.addEventListener('change', h)
    return () => q.removeEventListener('change', h)
  }, [])
  return m
}

export function useInboxPage(
  orgId: string | undefined,
  search: InboxSearchParams,
  onNavigate: InboxPageNav,
) {
  const { itemId: _, folder, tab, ...rest } = search
  const isMobile = useIsMobile()
  const filters: InboxFilterValues = useMemo(
    () => ({
      propertyId: rest.propertyId ?? undefined,
      status:
        folderToStatus(folder) ??
        (tab === 'unaddressed' ? (['new', 'read'] as const) : undefined),
      sourceType: rest.sourceType ?? undefined,
      platform: rest.platform ?? undefined,
      ratingMin: rest.ratingMin ?? undefined,
      ratingMax: rest.ratingMax ?? undefined,
      q: rest.q ?? undefined,
    }),
    [
      rest.propertyId,
      rest.sourceType,
      rest.platform,
      rest.ratingMin,
      rest.ratingMax,
      rest.q,
      folder,
      tab,
    ],
  )

  const {
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
  } = useInboxState(orgId, filters, search.itemId, onNavigate)

  // Stable reference — only recomputes when a different item is selected,
  // NOT when the same item's status/fields update (detail panel uses detailState.currentItem).
  const selectedItemId = search.itemId
  const foundItemId = items.find((i) => i.id === selectedItemId)?.id
  const selectedItem = useMemo(
    () => (selectedItemId ? (items.find((i) => i.id === selectedItemId) ?? null) : null),
    [selectedItemId, foundItemId],
  )
  const detailState = useInboxDetail(selectedItem, !!selectedItem, { autoMarkRead: true })

  useEffect(() => {
    if (detailState.statusVersion > 0 && detailState.currentItem) {
      const u = detailState.currentItem
      setItems((p) => {
        // FE-3: after a status change, drop the item from the current view
        // when its new status no longer matches the active filter (e.g.
        // marking as 'addressed' while viewing the 'new' tab). The selected-
        // detail auto-close effect in useInboxState then clears itemId.
        const visible = !filters.status
          ? true
          : typeof filters.status !== 'string'
            ? filters.status.includes(u.status)
            : filters.status === u.status
        if (!visible) return p.filter((i) => i.id !== u.id)
        return p.map((i) =>
          i.id === u.id ? { ...i, status: u.status, updatedAt: u.updatedAt } : i,
        )
      })
    }
  }, [detailState.statusVersion, detailState.currentItem, filters.status])

  useInboxKeyboardShortcuts({
    items,
    isMobile,
    selectedItem,
    handleRowClick,
    closeDetail,
  })

  const newCount = useMemo(() => items.filter((i) => i.status === 'new').length, [items])

  const handleToggleSelect = useCallback(
    (id: string) =>
      setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    [setSelectedIds],
  )
  const handleSelectAll = useCallback(
    () => setSelectedIds(items.map((i) => i.id)),
    [items, setSelectedIds],
  )
  const handleDeselectAll = useCallback(() => setSelectedIds([]), [setSelectedIds])

  return {
    isMobile,
    folder,
    tab,
    search,
    filters,
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
    selectedItem,
    detailState,
    newCount,
    handleToggleSelect,
    handleSelectAll,
    handleDeselectAll,
  }
}
