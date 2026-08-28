// Inbox page state hook — extracted from inbox-page-v2 for line-limit compliance.
import { useMemo, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { inboxCachePolicy } from './inbox-cache-policy'

export type InboxPageNav = (o: {
  to: '.'
  search: (p: InboxSearchParams) => Partial<InboxSearchParams>
  /** Replace transient typeahead state instead of growing browser history. */
  replace?: boolean
}) => void

export function useInboxPage(
  orgId: string | undefined,
  search: InboxSearchParams,
  onNavigate: InboxPageNav,
  inboxFns: InboxServerFns,
  recordInboxVisit: boolean,
) {
  const queryClient = useQueryClient()
  const stampedOrganization = useRef<string | null>(null)
  const stampingOrganization = useRef<string | null>(null)
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
    hasLoadedSuccessfully,
    responseCutoff,
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

  const { mutate: stampInboxVisit } = useMutation({
    mutationFn: (cutoff: Date) =>
      inboxFns.stampLastInboxView({ data: { responseCutoff: cutoff } }),
    onSuccess: () => inboxCachePolicy.onInboxVisited(queryClient),
    retry: 2,
  })

  useEffect(() => {
    if (
      !recordInboxVisit ||
      !orgId ||
      !hasLoadedSuccessfully ||
      responseCutoff === null ||
      stampedOrganization.current === orgId ||
      stampingOrganization.current === orgId
    ) {
      return
    }
    stampingOrganization.current = orgId
    stampInboxVisit(responseCutoff, {
      onSuccess: () => {
        stampedOrganization.current = orgId
      },
      onSettled: () => {
        if (stampingOrganization.current === orgId) {
          stampingOrganization.current = null
        }
      },
    })
  }, [hasLoadedSuccessfully, orgId, recordInboxVisit, responseCutoff, stampInboxVisit])

  // Resolve the selected row from the current query data so status and field
  // changes cannot leave the detail controller holding a stale object.
  const selectedItemId = search.itemId
  const selectedItem = useMemo(
    () => (selectedItemId ? (items.find((i) => i.id === selectedItemId) ?? null) : null),
    [items, selectedItemId],
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
