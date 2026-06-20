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
    newCount,
    showTabs,
    activeTab,
    searchQ,
    items,
    selectedIds,
    isLoading,
    nextCursor,
    loadAction,
    listRef,
    onTabChange,
    onSearchChange,
    onBulkDone,
    bulkUpdateFn,
    onLoadMore,
    onOpenSidebar,
  } = props

  return (
    <div className="flex h-full flex-col overflow-hidden border-r">
      <InboxListHeader
        folderLabel={folderLabel}
        newCount={newCount}
        showTabs={showTabs}
        activeTab={activeTab}
        searchQ={searchQ}
        onTabChange={onTabChange}
        onSearchChange={onSearchChange}
        onOpenSidebar={onOpenSidebar}
      />
      <BulkActionBar
        selectedIds={selectedIds}
        items={items}
        onBulkDone={onBulkDone}
        bulkUpdateFn={bulkUpdateFn}
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
