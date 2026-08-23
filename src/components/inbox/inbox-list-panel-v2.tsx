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
    folderLabel,
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
    onLoadMore,
    onOpenSidebar,
  } = props

  return (
    <div className="flex h-full flex-col overflow-hidden border-r">
      <InboxListHeader
        folderLabel={folderLabel}
        totalCount={totalCount}
        searchQ={searchQ}
        onSearchChange={onSearchChange}
        filters={filters}
        onFiltersChange={onFiltersChange}
        sort={sort}
        onSortChange={onSortChange}
        onOpenSidebar={onOpenSidebar}
        selectionToolbar={
          selectedIds.length > 0 ? (
            <BulkActionBar
              selectedIds={selectedIds}
              items={items}
              onBulkDone={onBulkDone}
              bulkUpdateFn={bulkUpdateFn}
              onSelectAll={onSelectAll}
              onDeselectAll={onDeselectAll}
            />
          ) : undefined
        }
      />
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {renderListContent(props)}
        <LoadMoreButton
          nextCursor={nextCursor}
          isLoading={isLoading}
          loadAction={loadAction}
          onLoadMore={onLoadMore}
        />
      </div>
    </div>
  )
}
