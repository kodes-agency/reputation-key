// Inbox page state hook — extracted from inbox-page-v2 for line-limit compliance.
import { useMemo, useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { useInboxCompactLayout } from '#/components/inbox/use-inbox-compact-layout'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import { useInboxVisitStamp } from '#/components/inbox/use-inbox-visit-stamp'
import { useInboxEscalationShortcut } from '#/components/inbox/use-inbox-escalation-shortcut'
import { useInboxSelectionActions } from '#/components/inbox/use-inbox-selection-actions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { ComposerFocusBox } from '#/components/inbox/inbox-detail-content'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxSearchParams } from './inbox-search-schema'
import type { InboxServerFns } from './types'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { mergeInboxCommandItem } from './inbox-cache-policy'
import { inboxKeys } from '#/shared/queries/query-keys'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { canUseReplyQueues, resolveInboxQueue } from './inbox-queues'

export type InboxPageNav = (o: {
  to: '.'
  search: (p: InboxSearchParams) => Partial<InboxSearchParams>
  /** Replace transient typeahead state instead of growing browser history. */
  replace?: boolean
}) => void

export function useInboxPage(
  orgId: string | undefined,
  viewerId: string | undefined,
  search: InboxSearchParams,
  onNavigate: InboxPageNav,
  inboxFns: InboxServerFns,
  recordInboxVisit: boolean,
) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const composerFocusRef = useRef<ComposerFocusBox['current']>(null)
  const { itemId: _, queue: requestedQueue, ...rest } = search
  const isMobile = useIsMobile()
  const isCompactLayout = useInboxCompactLayout()
  const canManageReplies = canUseReplyQueues(
    can('reply.manage'),
    has('property.publish_reply'),
  )
  const queue = resolveInboxQueue(requestedQueue, canManageReplies)
  const filters: InboxFilterValues = useMemo(
    () => ({
      propertyId: rest.propertyId ?? undefined,
      sourceType: rest.sourceType ?? undefined,
      ratingMin: rest.ratingMin ?? undefined,
      ratingMax: rest.ratingMax ?? undefined,
      attention: rest.attention ?? undefined,
      aspect: rest.aspect ?? undefined,
      polarity: rest.polarity ?? undefined,
      q: rest.q ?? undefined,
      sort: rest.sort ?? 'newest',
    }),
    [
      rest.propertyId,
      rest.sourceType,
      rest.ratingMin,
      rest.ratingMax,
      rest.attention,
      rest.aspect,
      rest.polarity,
      rest.q,
      rest.sort,
    ],
  )

  const queueCounts = useQuery({
    queryKey: inboxKeys.countsFor(rest.propertyId),
    queryFn: () =>
      inboxFns.getInboxQueueCounts({ data: { propertyId: rest.propertyId } }),
    enabled: !!orgId,
    staleTime: 0,
  })

  const {
    items,
    nextCursor,
    hasLoadedSuccessfully,
    responseCutoff,
    viewedUpTo,
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
  } = useInboxState(
    orgId,
    queue,
    viewerId,
    filters,
    search.itemId,
    onNavigate,
    inboxFns.getInboxItems,
  )

  useInboxVisitStamp({
    organizationId: orgId,
    enabled: recordInboxVisit,
    hasLoadedSuccessfully,
    responseCutoff,
    stampLastInboxView: inboxFns.stampLastInboxView,
  })

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
  const handleItemStatusChanged = useCallback(
    (commandItem: InboxItem) =>
      patchItem(
        selectedItem?.id === commandItem.id
          ? mergeInboxCommandItem(selectedItem, commandItem)
          : commandItem,
      ),
    [patchItem, selectedItem],
  )

  const detailState = useInboxDetail(selectedItem, !!selectedItemId, inboxFns, {
    selectedItemId,
    onItemStatusChanged: handleItemStatusChanged,
  })
  const resolvedSelectedItem = detailState.currentItem ?? selectedItem

  const focusReplyComposer = useCallback(() => composerFocusRef.current?.('reply'), [])
  const focusNoteComposer = useCallback(() => composerFocusRef.current?.('note'), [])
  const escalation = useInboxEscalationShortcut(resolvedSelectedItem, detailState, can)
  const selectionActions = useInboxSelectionActions(
    items,
    resolvedSelectedItem,
    setSelectedIds,
  )

  useInboxKeyboardShortcuts({
    items,
    isMobile,
    selectedItem: resolvedSelectedItem,
    handleRowClick,
    closeDetail,
    focusReplyComposer,
    focusNoteComposer,
    escalation,
    toggleSelect: selectionActions.toggleSelectedItem,
    openShortcuts: () => setShortcutsOpen(true),
  })

  return {
    isMobile,
    isCompactLayout,
    queue,
    canManageReplies,
    queueCounts: queueCounts.data,
    shortcutsOpen,
    setShortcutsOpen,
    search,
    filters,
    items,
    nextCursor,
    totalCount,
    viewedUpTo,
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
    selectedItem: resolvedSelectedItem,
    detailState,
    composerFocusRef,
    handleToggleSelect: selectionActions.toggleItem,
    handleSelectAll: selectionActions.selectAll,
    handleDeselectAll: selectionActions.deselectAll,
  }
}
