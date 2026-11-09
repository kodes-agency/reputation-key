import { useMemo, useCallback, useRef, useState } from 'react'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { useInboxCompactLayout } from '#/components/inbox/use-inbox-compact-layout'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import { useInboxVisitStamp } from '#/components/inbox/use-inbox-visit-stamp'
import { useInboxEscalationShortcut } from '#/components/inbox/use-inbox-escalation-shortcut'
import { useInboxPriorityShortcut } from '#/components/inbox/use-inbox-priority-shortcut'
import { useInboxSelectionActions } from '#/components/inbox/use-inbox-selection-actions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { ComposerFocusBox } from '#/contexts/reputation/inbox/ui/inbox-detail-content'
import type { InboxSearchParams } from './inbox-search-schema'
import type { InboxServerFns } from './types'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { mergeInboxCommandItem } from './inbox-cache-policy'
import { useInboxQueueState } from './use-inbox-queue-state'

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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const composerFocusRef = useRef<ComposerFocusBox['current']>(null)
  const isMobile = useIsMobile()
  const isCompactLayout = useInboxCompactLayout()
  const { queue, canManageReplies, queueViewer, queueCounts, filters } =
    useInboxQueueState(orgId, search, inboxFns.getInboxQueueCounts)

  const {
    items,
    nextCursor,
    hasLoadedSuccessfully,
    responseCutoff,
    viewedUpTo,
    totalCount,
    isLoading,
    isRefreshing,
    error,
    isRetrying,
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
    canManageReplies,
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
  const priority = useInboxPriorityShortcut(resolvedSelectedItem, detailState, can)
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
    priority,
    toggleSelect: selectionActions.toggleSelectedItem,
    openShortcuts: () => setShortcutsOpen(true),
  })

  return {
    isMobile,
    isCompactLayout,
    queue,
    canManageReplies,
    queueViewer,
    queueCounts,
    shortcutsOpen,
    setShortcutsOpen,
    search,
    filters,
    items,
    nextCursor,
    totalCount,
    viewedUpTo,
    isLoading,
    isRefreshing,
    error,
    isRetrying,
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
