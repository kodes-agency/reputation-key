// Inbox list panel — extracted from inbox-page-v2 for line-count compliance.
// Header + bulk bar + scroll area (content + load-more). Presentational parts
// live in inbox-list-panel-parts.tsx.

import { cn } from '#/lib/utils'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { InboxActiveFilters } from '#/components/inbox/inbox-active-filters'
import { InboxListHeader } from '#/components/inbox/inbox-list-header'
import {
  BulkActionBar,
  InboxLoadMore,
  renderListContent,
  type InboxListPanelProps,
} from './inbox-list-panel-parts'

export type { InboxListPanelProps } from './inbox-list-panel-parts'

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
            <BulkActionBar
              selectedIds={selectedIds}
              items={items}
              onBulkDone={onBulkDone}
              bulkUpdateFn={bulkUpdateFn}
              bulkAssignFn={bulkAssignFn}
              assignmentOptions={assignmentOptions}
              onSelectAll={onSelectAll}
              onDeselectAll={onDeselectAll}
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
