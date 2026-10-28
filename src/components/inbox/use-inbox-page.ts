// Inbox page state hook — extracted from inbox-page-v2 for line-limit compliance.
import { useMemo, useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { useInboxCompactLayout } from '#/components/inbox/use-inbox-compact-layout'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import { useInboxVisitStamp } from '#/components/inbox/use-inbox-visit-stamp'
import { useInboxTriageShortcuts } from '#/components/inbox/use-inbox-triage-shortcuts'
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
import { canUseReplyQueues, resolveReplyStages } from './inbox-queues'
import { resolveInboxQueue, type InboxQueueViewer } from './inbox-queue-sections'
import { filtersOffered } from './inbox-filter-offer'

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
  // Counted first: they carry the server's answer to "are there reply stages
  // here?", which the rail, the labels and the list below all draw from. They
  // depend on the scope in view and nothing the queue decides.
  const queueCounts = useQuery({
    queryKey: inboxKeys.countsFor(rest.propertyId),
    queryFn: () =>
      inboxFns.getInboxQueueCounts({ data: { propertyId: rest.propertyId } }),
    enabled: !!orgId,
    staleTime: 0,
  })
  // The server decides, for the scope; the browser's own permissions and
  // capability set only guess until its answer arrives (`resolveReplyStages`).
  const canManageReplies = resolveReplyStages(
    queueCounts.data,
    canUseReplyQueues(can('reply.manage'), has('property.publish_reply')),
  )
  const canReadReviews = can('review.read')
  const canReadFeedback = can('feedback.read')
  const queueViewer: InboxQueueViewer = useMemo(
    () => ({ canManageReplies, canReadReviews, canReadFeedback }),
    [canManageReplies, canReadReviews, canReadFeedback],
  )
  const queue = resolveInboxQueue(requestedQueue, queueViewer)
  const offer = filtersOffered(queue)
  // A filter the queue does not offer is not applied either (inbox-filter-offer).
  const filters: InboxFilterValues = useMemo(
    () => ({
      propertyId: rest.propertyId ?? undefined,
      sourceType: offer.source ? (rest.sourceType ?? undefined) : undefined,
      ratingMin: rest.ratingMin ?? undefined,
      ratingMax: rest.ratingMax ?? undefined,
      attention: offer.priority ? (rest.attention ?? undefined) : undefined,
      aspect: offer.topics ? (rest.aspect ?? undefined) : undefined,
      polarity: offer.topics ? (rest.polarity ?? undefined) : undefined,
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
      offer.source,
      offer.priority,
      offer.topics,
    ],
  )

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
  const { escalation, priority } = useInboxTriageShortcuts(
    resolvedSelectedItem,
    detailState,
    can,
  )
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
