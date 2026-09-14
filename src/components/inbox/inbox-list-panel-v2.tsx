// Inbox list panel — extracted from inbox-page-v2 for line-count compliance.
// Header + bulk bar + scroll area (content + load-more). Presentational parts
// live in inbox-list-panel-parts.tsx.

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

  return (
    <div className="flex h-full flex-col overflow-hidden border-r">
      <InboxListHeader
        queueLabel={queueLabel}
        scopeLabel={scopeLabel}
        totalCount={totalCount}
        searchQ={searchQ}
        onSearchChange={onSearchChange}
        filters={filters}
        onFiltersChange={onFiltersChange}
        sort={sort}
        onSortChange={onSortChange}
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
