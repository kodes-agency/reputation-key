// Inbox list panel — extracted from inbox-page-v2 for line-count compliance.
// Header + bulk bar + scroll area (content + load-more). Presentational parts
// live in inbox-list-panel-parts.tsx.

import { useIsMobile } from '#/components/hooks/use-mobile'
import { InboxActiveFilters } from '#/components/inbox/inbox-active-filters'
import { InboxListHeader } from '#/components/inbox/inbox-list-header'
import {
  BulkActionBar,
  LoadMoreButton,
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
    searchQ,
    filters,
    sort,
    items,
    selectedIds,
    isLoading,
    nextCursor,
    loadAction,
    listRef,
    onSearchChange,
    onFiltersChange,
    onSortChange,
    onClearAll,
    onSelectAll,
    onDeselectAll,
    onBulkDone,
    bulkUpdateFn,
    bulkAssignFn,
    assignmentOptions,
    isCompactLayout,
    onLoadMore,
    onStartSelection,
    queueStrip,
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
        searchQ={searchQ}
        onSearchChange={onSearchChange}
        filters={filters}
        onFiltersChange={onFiltersChange}
        sort={sort}
        isLoading={isLoading}
        onSortChange={onSortChange}
        onClearAll={onClearAll}
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
      {queueStrip}
      {/* Phone only: shown whenever `useIsMobile` says phone, the header's own test. */}
      {isMobile && (
        <InboxActiveFilters
          filters={filters}
          sort={sort}
          onFiltersChange={onFiltersChange}
          onSortChange={onSortChange}
          onClearAll={onClearAll}
        />
      )}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {renderListContent(props)}
        <LoadMoreButton
          nextCursor={nextCursor}
          loadedCount={items.length}
          totalCount={totalCount}
          isLoading={isLoading}
          loadAction={loadAction}
          onLoadMore={onLoadMore}
        />
      </div>
    </div>
  )
}
