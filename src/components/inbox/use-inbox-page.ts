// Inbox page state hook — extracted from inbox-page-v2 for line-limit compliance.
import { useMemo, useCallback } from 'react'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxSearchParams } from './inbox-search-schema'
import { folderToStatus, folderIsEscalated } from './inbox-search-schema'
import type { InboxServerFns } from './types'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import { toggleInboxSelection } from './inbox-selection'

export type InboxPageNav = (o: {
  to: '.'
  search: (p: InboxSearchParams) => Partial<InboxSearchParams>
}) => void

export function useInboxPage(
  orgId: string | undefined,
  search: InboxSearchParams,
  onNavigate: InboxPageNav,
  inboxFns: InboxServerFns,
) {
  const { itemId: _, folder, ...rest } = search
  const isMobile = useIsMobile()
  const filters: InboxFilterValues = useMemo(
    () => ({
      propertyId: rest.propertyId ?? undefined,
      status: folderToStatus(folder),
      isEscalated: folderIsEscalated(folder) ? true : undefined,
      sourceType: rest.sourceType ?? undefined,
      platform: rest.platform ?? undefined,
      ratingMin: rest.ratingMin ?? undefined,
      ratingMax: rest.ratingMax ?? undefined,
      attention: rest.attention ?? undefined,
      category: rest.category ?? undefined,
      q: rest.q ?? undefined,
      sort: rest.sort ?? 'newest',
    }),
    [
      rest.propertyId,
      rest.sourceType,
      rest.platform,
      rest.ratingMin,
      rest.ratingMax,
      rest.attention,
      rest.category,
      rest.q,
      rest.sort,
      folder,
    ],
  )

  const {
    items,
    nextCursor,
    totalCount,
    isLoading,
    error,
    selectedIds,
    setSelectedIds,
    loadAction,
    loadMore,
    refetch,
    patchItem,
    handleRowClick,
    closeDetail,
    handleBulkDone,
  } = useInboxState(orgId, filters, search.itemId, onNavigate, inboxFns.getInboxItems)

  // Stable reference — only recomputes when a different item is selected,
  // NOT when the same item's status/fields update (detail panel uses detailState.currentItem).
  const selectedItemId = search.itemId
  const foundItemId = items.find((i) => i.id === selectedItemId)?.id
  const selectedItem = useMemo(
    () => (selectedItemId ? (items.find((i) => i.id === selectedItemId) ?? null) : null),
    [selectedItemId, foundItemId],
  )
  // Optimistic list sync after a detail status change (mark-read / escalate /
  // archive): delegates to useInboxState.patchItem, which patches the cached
  // infinite-query pages (update status in-place, or drop if it leaves the filter).
  const handleItemStatusChanged = useCallback((u: InboxItem) => patchItem(u), [patchItem])

  const detailState = useInboxDetail(selectedItem, !!selectedItem, inboxFns, {
    onItemStatusChanged: handleItemStatusChanged,
  })

  useInboxKeyboardShortcuts({
    items,
    isMobile,
    selectedItem,
    handleRowClick,
    closeDetail,
  })

  const handleToggleSelect = useCallback(
    (id: string) => setSelectedIds((previous) => toggleInboxSelection(previous, id)),
    [setSelectedIds],
  )
  const handleSelectAll = useCallback(
    () => setSelectedIds(items.slice(0, INBOX_BULK_LIMIT).map((i) => i.id)),
    [items, setSelectedIds],
  )
  const handleDeselectAll = useCallback(() => setSelectedIds([]), [setSelectedIds])

  return {
    isMobile,
    folder,
    search,
    filters,
    items,
    nextCursor,
    totalCount,
    isLoading,
    error,
    selectedIds,
    setSelectedIds,
    loadAction,
    loadMore,
    refetch,
    handleRowClick,
    closeDetail,
    handleBulkDone,
    selectedItem,
    detailState,
    handleToggleSelect,
    handleSelectAll,
    handleDeselectAll,
  }
}
