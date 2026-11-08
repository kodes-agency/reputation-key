import { cn } from '#/lib/utils'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { InboxActiveFilters } from '#/components/inbox/inbox-active-filters'
import { InboxListHeader } from '#/components/inbox/inbox-list-header'
import {
  INBOX_BULK_LIMIT,
  type Cursor,
  type InboxItem,
  type InboxSort,
  type InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { LoadMoreButton } from '#/components/ui/load-more-button'
import type { InboxServerFns } from '#/components/inbox/types'
import type { InboxAssignmentOption } from '#/components/inbox/inbox-owner-view'
import { useMemo, type ReactNode, type RefObject } from 'react'
import {
  countActiveInboxFilters,
  type InboxListFilterValues,
} from '#/components/inbox/inbox-filters'
import {
  InboxListEmpty,
  InboxListError,
  InboxListSkeleton,
} from '#/components/inbox/inbox-list-states'
import type { InboxCurrentUser } from '#/components/inbox/inbox-case-toolbar-props'
import { InboxListRow } from '#/components/inbox/inbox-list-row'

export interface InboxListPanelProps {
  queue: InboxQueue
  /** Reply stages are available; without them the reply queue reads "Open". */
  hasReplyStages: boolean
  queueLabel: string
  scopeLabel: string
  /** The header's scope control, when the scope can be changed from the list. */
  scopeControl?: ReactNode
  /** At organization scope every row names its property. */
  showPropertyNames: boolean
  totalCount: number
  /** What the queue holds before any search or filter; null until its count has arrived. */
  queueTotal: number | null
  searchQ: string | undefined
  filters: InboxListFilterValues
  sort: InboxSort
  items: readonly InboxItem[]
  selectedIds: readonly string[]
  activeItemId: string | undefined
  isLoading: boolean
  /**
   * The rows shown are the previous list's, kept while this one loads: dimmed,
   * their count and "load more" not quoted.
   */
  isRefreshing?: boolean
  error: string | null
  onRetry: () => void
  /** Try again is reading; the error panel stays, its button busy. */
  isRetrying?: boolean
  nextCursor: Cursor | null
  loadAction: { isPending: boolean }
  listRef: RefObject<HTMLDivElement | null>
  onSearchChange: (q: string | undefined) => void
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  /** Drops the search and every filter in one navigation; the sort stays. */
  onClearFilters: () => void
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
  onLoadMore: (cursor?: Cursor) => Promise<void>
  onBulkDone: () => void
  bulkUpdateFn: InboxServerFns['bulkUpdateInboxStatus']
  bulkAssignFn: InboxServerFns['bulkAssignInboxItems']
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  viewedUpTo: Date | null
  isCompactLayout: boolean
  selectionMode?: boolean
  onStartSelection?: () => void
  /** The phone's queue bar, between the header and the list. */
  queueBar?: ReactNode
  /**
   * What the empty To handle queue offers beside its explanation (a way to set up
   * the page feedback comes from). Mounted only while that state shows, so what it
   * reads is read only then.
   */
  feedbackEmptyAction?: ReactNode
}

function renderListContent(props: InboxListPanelProps): ReactNode {
  // The failure comes first: a retry resets the query to pending, and the panel
  // must stay, its button busy, rather than give way to the skeleton.
  if (props.error) {
    return (
      <InboxListError
        error={props.error}
        onRetry={props.onRetry}
        isRetrying={props.isRetrying ?? false}
      />
    )
  }
  // Kept rows are the previous list's. An empty previous list is no answer for
  // this one, so it gives way to the skeleton rather than say "no matches".
  if (props.isLoading || (props.isRefreshing && props.items.length === 0)) {
    return <InboxListSkeleton />
  }
  if (props.items.length === 0) {
    return (
      <InboxListEmpty
        queue={props.queue}
        hasReplyStages={props.hasReplyStages}
        isFiltered={!!props.searchQ || countActiveInboxFilters(props.filters) > 0}
        searching={!!props.searchQ}
        onClearFilters={props.onClearFilters}
        feedbackAction={props.feedbackEmptyAction}
      />
    )
  }
  return (
    <InboxList
      items={props.items}
      selectedIds={props.selectedIds}
      activeItemId={props.activeItemId}
      onToggleSelect={props.onToggleSelect}
      onRowClick={props.onRowClick}
      selectionMode={props.selectionMode}
      allProperties={props.showPropertyNames}
      assignmentOptions={props.assignmentOptions}
      currentUser={props.currentUser}
      viewedUpTo={props.viewedUpTo}
    />
  )
}

/** Renders nothing until there is a next page and the initial load is done. */
function InboxLoadMore({
  nextCursor,
  loadedCount,
  totalCount,
  isLoading,
  loadAction,
  onLoadMore,
}: {
  nextCursor: Cursor | null
  loadedCount: number
  totalCount: number
  isLoading: boolean
  loadAction: { isPending: boolean }
  onLoadMore: (cursor?: Cursor) => Promise<void>
}) {
  if (!nextCursor || isLoading) return null
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-4">
      <span className="text-xs tabular-nums text-muted-foreground">
        {loadedCount} of {totalCount}
      </span>
      <LoadMoreButton
        loading={loadAction.isPending}
        onLoadMore={() => void onLoadMore(nextCursor)}
      />
    </div>
  )
}

export function InboxListPanel(props: InboxListPanelProps) {
  const {
    queueLabel,
    scopeLabel,
    scopeControl,
    totalCount,
    queueTotal,
    searchQ,
    filters,
    sort,
    items,
    selectedIds,
    isLoading,
    isRefreshing = false,
    nextCursor,
    loadAction,
    listRef,
    onSearchChange,
    onFiltersChange,
    onSortChange,
    onClearFilters,
    onSelectAll,
    onDeselectAll,
    onBulkDone,
    bulkUpdateFn,
    bulkAssignFn,
    assignmentOptions,
    isCompactLayout,
    onLoadMore,
    onStartSelection,
    queueBar,
    queue,
  } = props
  const isMobile = useIsMobile()

  return (
    // The panel is the whole screen on a phone: a right border would be a 1px
    // line at the screen edge that makes every bar 1px narrower.
    <div
      data-inbox-list-panel
      className="flex h-full flex-col overflow-hidden border-r max-md:border-r-0"
    >
      <InboxListHeader
        queueLabel={queueLabel}
        scopeLabel={scopeLabel}
        scopeControl={scopeControl}
        totalCount={totalCount}
        queueTotal={queueTotal}
        searchQ={searchQ}
        onSearchChange={onSearchChange}
        queue={queue}
        filters={filters}
        onFiltersChange={onFiltersChange}
        sort={sort}
        isLoading={isLoading || isRefreshing}
        onSortChange={onSortChange}
        onClearFilters={onClearFilters}
        onStartSelection={onStartSelection}
        isCompactLayout={isCompactLayout}
        selectionToolbar={
          selectedIds.length > 0 ? (
            <InboxBulkActions
              selectedIds={selectedIds}
              items={items}
              onDone={onBulkDone}
              bulkUpdateFn={bulkUpdateFn}
              bulkAssignFn={bulkAssignFn}
              assignmentOptions={assignmentOptions}
              onSelectAll={onSelectAll}
              onClearSelection={onDeselectAll}
            />
          ) : undefined
        }
      />
      {queueBar}
      {/* Phone only: shown whenever `useIsMobile` says phone, the header's own test. */}
      {isMobile && (
        <InboxActiveFilters
          filters={filters}
          sort={sort}
          onFiltersChange={onFiltersChange}
          onSortChange={onSortChange}
          searching={searchQ !== undefined}
          onClearFilters={onClearFilters}
        />
      )}
      <div
        ref={listRef}
        aria-busy={isRefreshing}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto transition-opacity motion-reduce:transition-none',
          isRefreshing && 'opacity-60',
        )}
      >
        {renderListContent(props)}
        <InboxLoadMore
          nextCursor={nextCursor}
          loadedCount={items.length}
          totalCount={totalCount}
          isLoading={isLoading || isRefreshing}
          loadAction={loadAction}
          onLoadMore={onLoadMore}
        />
      </div>
    </div>
  )
}

export function InboxList({
  items,
  selectedIds,
  activeItemId,
  selectionMode = false,
  allProperties = false,
  assignmentOptions = [],
  currentUser,
  viewedUpTo = null,
  onToggleSelect,
  onRowClick,
}: Readonly<{
  items: ReadonlyArray<InboxItem>
  selectedIds: ReadonlyArray<string>
  activeItemId: string | undefined
  selectionMode?: boolean
  allProperties?: boolean
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  viewedUpTo?: Date | null
  onToggleSelect: (id: string) => void
  onRowClick: (item: InboxItem) => void
}>) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectionAtLimit = selectedIds.length >= INBOX_BULK_LIMIT
  return (
    <div role="list" aria-label="Inbox items" className="flex flex-col">
      {items.map((item) => (
        <InboxListRow
          key={item.id}
          item={item}
          isChecked={selectedSet.has(item.id)}
          isActive={activeItemId === item.id}
          selectionAtLimit={selectionAtLimit}
          selectionMode={selectionMode || selectedIds.length > 0}
          allProperties={allProperties}
          assignmentOptions={assignmentOptions}
          currentUser={currentUser}
          viewedUpTo={viewedUpTo}
          onToggleSelect={onToggleSelect}
          onOpen={onRowClick}
        />
      ))}
    </div>
  )
}
