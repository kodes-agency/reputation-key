// Inbox workspace: fixed queue rail, resizable list, and the v2.1 detail pane.
import type { InboxCtx } from './inbox-types'
import {
  InboxListPanel,
  type InboxListPanelProps,
} from '#/components/inbox/inbox-list-panel-v2'
import { useInboxPage, type InboxPageNav } from './use-inbox-page'
import { replaceInboxSearch } from './inbox-navigation'
import type { InboxServerFns } from './types'
import { useRef, useState } from 'react'
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'
import { useHydrated } from '#/components/hooks/use-hydrated'
import type { InboxSearchParams } from './inbox-search-schema'
import {
  ResizeHandle,
  InboxNoOrgState,
  InboxDetailPane,
  INBOX_PANEL_IDS,
  CLIP_PANEL_CONTENT,
  HYDRATING_LAYOUT_STORAGE,
  inboxLayoutStorage,
} from './inbox-page-parts'
import { InboxDetailSheet } from './inbox-detail-sheet'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { InboxQueueRail } from './inbox-queue-rail'
import { InboxQueueStrip } from './inbox-queue-strip'
import { InboxShortcutsDialog } from './inbox-shortcuts-dialog'
import { queueLabel } from './inbox-queues'
import type { InboxPropertyScopeInput } from './inbox-property-scope'
import { InboxScopeMenu } from './inbox-scope-menu'
import { useInboxPropertyScope } from './use-inbox-property-scope'

export function InboxPageV2({
  ctx,
  search,
  onNavigate,
  inboxFns,
  recordInboxVisit = false,
  activePropertyId,
  assignmentOptions = [],
  scopeLabel = activePropertyId ? 'Property' : 'All properties',
  propertyScope,
}: {
  ctx: InboxCtx
  search: InboxSearchParams
  onNavigate: InboxPageNav
  inboxFns: InboxServerFns
  /** True only for the Organization-wide /inbox route. */
  recordInboxVisit?: boolean
  /** Active property — from route param on /reviews, from search on /inbox. */
  activePropertyId?: string
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  scopeLabel?: string
  /** The properties this viewer can move the Inbox between. */
  propertyScope?: InboxPropertyScopeInput
}) {
  const s = useInboxPage(
    ctx.activeOrganization?.id,
    ctx.user?.id,
    { ...search, propertyId: activePropertyId ?? search.propertyId },
    onNavigate,
    inboxFns,
    recordInboxVisit,
  )
  const scope = useInboxPropertyScope(
    propertyScope,
    s.queue,
    !!ctx.activeOrganization?.id,
    inboxFns.getInboxPropertyCounts,
  )
  const listRef = useRef<HTMLDivElement>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  // Replaces the v2 `autoSaveId` prop, which v4 dropped in favour of an
  // explicit hook. Must run before the no-org early return below. The saved
  // layout is read only after hydration (see `inboxLayoutStorage`); the Group
  // is keyed on it because `defaultLayout` is consumed at mount.
  const hydrated = useHydrated()
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'inbox-layout-v2',
    storage: hydrated ? inboxLayoutStorage : HYDRATING_LAYOUT_STORAGE,
  })

  if (!ctx.activeOrganization?.id) return <InboxNoOrgState />

  const listPanelProps: InboxListPanelProps = {
    queue: s.queue,
    queueLabel: queueLabel(s.queue),
    scopeLabel,
    showPropertyNames: !(activePropertyId ?? search.propertyId),
    totalCount: s.totalCount,
    searchQ: search.q,
    filters: {
      sourceType: search.sourceType,
      ratingMin: search.ratingMin,
      ratingMax: search.ratingMax,
      attention: search.attention,
      aspect: search.aspect,
      polarity: search.polarity,
    },
    sort: search.sort ?? 'newest',
    items: s.items,
    selectedIds: s.selectedIds,
    activeItemId: search.itemId,
    isLoading: s.isLoading,
    error: s.error,
    onRetry: s.refetch,
    nextCursor: s.nextCursor,
    loadAction: s.loadAction,
    listRef,
    onSearchChange: (q) => onNavigate(replaceInboxSearch(q)),
    onFiltersChange: (patch) =>
      onNavigate({
        to: '.',
        search: (p) => ({ ...p, ...patch, itemId: undefined }),
      }),
    onSortChange: (sort) =>
      onNavigate({ to: '.', search: (p) => ({ ...p, sort, itemId: undefined }) }),
    onToggleSelect: s.handleToggleSelect,
    onSelectAll: s.handleSelectAll,
    onDeselectAll: () => {
      setSelectionMode(false)
      s.handleDeselectAll()
    },
    onRowClick: s.handleRowClick,
    onLoadMore: s.loadMore,
    onBulkDone: s.handleBulkDone,
    bulkUpdateFn: inboxFns.bulkUpdateInboxStatus,
    bulkAssignFn: inboxFns.bulkAssignInboxItems,
    assignmentOptions,
    currentUser: ctx.user,
    viewedUpTo: s.viewedUpTo,
    isCompactLayout: s.isCompactLayout,
    selectionMode,
    onStartSelection: () => setSelectionMode(true),
  }

  const changeQueue = (queue: typeof s.queue) => {
    setSelectionMode(false)
    s.handleDeselectAll()
    onNavigate({
      to: '.',
      search: (previous) => ({ ...previous, queue, itemId: undefined }),
    })
  }

  if (s.isCompactLayout) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <InboxListPanel
          {...listPanelProps}
          scopeControl={
            scope && (
              <InboxScopeMenu
                scope={scope}
                scopeLabel={scopeLabel}
                queueLabel={queueLabel(s.queue)}
              />
            )
          }
          queueStrip={
            <InboxQueueStrip
              queue={s.queue}
              counts={s.queueCounts}
              canManageReplies={s.canManageReplies}
              onQueueChange={changeQueue}
            />
          }
        />
        <InboxDetailSheet
          open={!!s.selectedItem}
          onOpenChange={(o) => {
            if (!o) s.closeDetail()
          }}
          item={s.selectedItem}
          detailState={s.detailState}
          detailFns={inboxFns}
          currentUser={ctx.user}
          assignmentOptions={assignmentOptions}
          composerFocusRef={s.composerFocusRef}
        />
        <InboxShortcutsDialog open={s.shortcutsOpen} onOpenChange={s.setShortcutsOpen} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0">
      <InboxQueueRail
        queue={s.queue}
        counts={s.queueCounts}
        canManageReplies={s.canManageReplies}
        propertyScope={scope}
        onQueueChange={changeQueue}
        onOpenShortcuts={() => s.setShortcutsOpen(true)}
      />
      <Group
        key={defaultLayout ? 'saved-layout' : 'default-layout'}
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="h-full min-w-0 flex-1"
      >
        <Panel
          id={INBOX_PANEL_IDS.list}
          defaultSize={400}
          minSize={320}
          maxSize="50%"
          style={CLIP_PANEL_CONTENT}
        >
          <InboxListPanel {...listPanelProps} />
        </Panel>
        <ResizeHandle />
        <InboxDetailPane
          selectedItem={s.selectedItem}
          detailState={s.detailState}
          onClose={s.closeDetail}
          detailFns={inboxFns}
          currentUser={ctx.user}
          assignmentOptions={assignmentOptions}
          composerFocusRef={s.composerFocusRef}
        />
      </Group>
      <InboxShortcutsDialog open={s.shortcutsOpen} onOpenChange={s.setShortcutsOpen} />
    </div>
  )
}
