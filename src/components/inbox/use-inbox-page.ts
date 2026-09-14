// Inbox page state hook — extracted from inbox-page-v2 for line-limit compliance.
import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { useInboxCompactLayout } from '#/components/inbox/use-inbox-compact-layout'
import { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import { useInboxState } from '#/components/inbox/use-inbox-state'
import { useInboxKeyboardShortcuts } from '#/components/inbox/use-inbox-keyboard-shortcuts'
import { isHeaderCommandPending } from '#/components/inbox/inbox-header-command-pending'
import {
  isCaseToolbarShown,
  itemCommandFence,
} from '#/components/inbox/inbox-case-toolbar-props'
import { INBOX_SOURCE_HANDLE_PERMISSION } from '#/components/inbox/inbox-owner-control'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { ComposerFocusBox } from '#/components/inbox/inbox-detail-content'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import type { InboxSearchParams } from './inbox-search-schema'
import type { InboxServerFns } from './types'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import { toggleInboxSelection } from './inbox-selection'
import { inboxCachePolicy, mergeInboxCommandItem } from './inbox-cache-policy'
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
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const stampedOrganization = useRef<string | null>(null)
  const stampingOrganization = useRef<string | null>(null)
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
  /**
   * `e`, with exactly the toolbar escalation member's own three refusals
   * (`inbox-detail-manager-actions.tsx`, the third member of the case toolbar
   * since plan v2.1 row 5): a caller who fails its gate gets no button, a pane
   * that is loading or failed shows no toolbar and so no button, and a command
   * already in flight disables it. A shortcut must not reach past a control the
   * pane has taken away — in the in-flight case it would also ship a
   * `commandRevision` that is going stale, since all six item commands share
   * one fence. Memoised because the window listener re-subscribes whenever
   * this object changes.
   *
   * The loading/error refusal is new with row 5. In the header the button
   * rendered in every branch of the pane; in the toolbar it renders only once
   * `InboxDetailContent` does, so `isCaseToolbarShown` — the panel's and the
   * sheet's own render condition — is part of the gate
   * (`inbox-case-toolbar-props.ts`, where the reasoning and the test live).
   *
   * The gate is that member's three conjuncts, not `inbox.manage` alone as it
   * was while the button lived in the header. Both server commands check
   * `inbox.write` and then `canHandleInboxSource`, which is `inbox.write` AND
   * the source's handle permission (`escalate-inbox-item.ts:42,52`,
   * `resolve-escalation.ts:41,51`, `inbox-access.ts:36`); `inbox.manage` stays
   * on top as the product's narrower rule. For every built-in role the three
   * coincide, so only a custom role sees a difference — and that difference is
   * a key that used to issue a command the server refused. The source half
   * depends on the SELECTED item, so there is no gate at all without one.
   *
   * Computed to a boolean here, outside the memo: `can` is a fresh closure
   * every render and would rebuild the listener every render as a dependency.
   */
  const canEscalateSelected =
    resolvedSelectedItem !== null &&
    isCaseToolbarShown(detailState) &&
    can('inbox.write') &&
    can(INBOX_SOURCE_HANDLE_PERMISSION[resolvedSelectedItem.sourceType]) &&
    can('inbox.manage')
  const isCommandPending = isHeaderCommandPending(detailState)
  // Destructured, not read off `detailState` inside the memo: the bag is a
  // fresh object literal every render, so depending on it would rebuild the
  // listener every render. The two Actions themselves are what matter.
  const { escalate: escalateItem, resolveEscalation: resolveItemEscalation } = detailState
  const escalation = useMemo(
    () => ({
      isAllowed: canEscalateSelected,
      isPending: isCommandPending,
      escalate: () => {
        if (!resolvedSelectedItem) return
        void escalateItem({ data: itemCommandFence(resolvedSelectedItem) })
      },
      resolveEscalation: () => {
        if (!resolvedSelectedItem) return
        void resolveItemEscalation({ data: itemCommandFence(resolvedSelectedItem) })
      },
    }),
    [
      canEscalateSelected,
      isCommandPending,
      resolvedSelectedItem,
      escalateItem,
      resolveItemEscalation,
    ],
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
    toggleSelect: resolvedSelectedItem
      ? () =>
          setSelectedIds((previous) =>
            toggleInboxSelection(previous, resolvedSelectedItem.id),
          )
      : undefined,
    openShortcuts: () => setShortcutsOpen(true),
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
    handleToggleSelect,
    handleSelectAll,
    handleDeselectAll,
  }
}
