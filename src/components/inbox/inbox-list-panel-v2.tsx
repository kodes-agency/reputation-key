// Inbox list panel — extracted from inbox-page-v2 for line-count compliance.
// Contains loading skeletons, empty state, bulk actions bar, and the list itself.

import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Cursor } from '#/contexts/inbox/application/public-api'
import { InboxListV2 } from '#/components/inbox/inbox-list-v2'
import { InboxListHeader } from '#/components/inbox/inbox-list-header'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { Button } from '#/components/ui/button'
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { Inbox, Loader2 } from 'lucide-react'
import type { RefObject } from 'react'

interface InboxListPanelProps {
  folderLabel: string
  newCount: number
  showTabs: boolean
  activeTab: 'all' | 'unaddressed' | undefined
  searchQ: string | undefined
  items: readonly InboxItem[]
  selectedIds: readonly string[]
  isLoading: boolean
  nextCursor: Cursor | null
  loadAction: { isPending: boolean }
  listRef: RefObject<HTMLDivElement | null>
  onTabChange: (t: 'all' | 'unaddressed' | undefined) => void
  onSearchChange: (q: string | undefined) => void
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
  onLoadMore: (cursor?: Cursor) => Promise<void>
  onBulkDone: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}

export function InboxListPanel({
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
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onRowClick,
  onLoadMore,
  onBulkDone,
  bulkUpdateFn,
}: InboxListPanelProps) {
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
      />

      {selectedIds.length > 0 && (
        <div className="shrink-0 border-b bg-surface px-4 py-2">
          <InboxBulkActions
            selectedIds={selectedIds}
            items={items}
            onDone={onBulkDone}
            bulkUpdateFn={bulkUpdateFn}
          />
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b px-4 py-3">
                <Skeleton className="size-4 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-12">
            <EmptyState icon={Inbox} title={`No ${folderLabel.toLowerCase()} items`}>
              <p className="text-sm text-muted-foreground">
                New reviews and feedback will appear here.
              </p>
            </EmptyState>
          </div>
        ) : (
          <InboxListV2
            items={items}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onRowClick={onRowClick}
          />
        )}

        {nextCursor && !isLoading && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              disabled={loadAction.isPending}
              onClick={() => onLoadMore(nextCursor ?? undefined)}
            >
              {loadAction.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
