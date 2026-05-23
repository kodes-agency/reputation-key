import { Loader2, Inbox } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxList } from '#/components/inbox/inbox-list'
import { InboxFilters } from '#/components/inbox/inbox-filters'
import type { InboxFilterValues } from '#/components/inbox/inbox-filters'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { Badge } from '#/components/ui/badge'
import type { InboxItem, Cursor } from '#/contexts/inbox/application/public-api'

interface InboxListPanelProps {
  filters: InboxFilterValues
  items: ReadonlyArray<InboxItem>
  selectedIds: ReadonlyArray<string>
  isLoading: boolean
  isPending: boolean
  nextCursor: Cursor | null
  onFiltersChange: (next: InboxFilterValues) => void
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
  onLoadMore: (cursor: Cursor) => void
  onBulkDone: () => void
}

export function InboxListPanel({
  filters,
  items,
  selectedIds,
  isLoading,
  isPending,
  nextCursor,
  onFiltersChange,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onRowClick,
  onLoadMore,
  onBulkDone,
}: InboxListPanelProps) {
  const newCount = items.filter((i) => i.status === 'new').length

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          {newCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {newCount} new
            </Badge>
          )}
        </div>
      </div>
      <InboxFilters value={filters} onChange={onFiltersChange} />
      <InboxBulkActions selectedIds={selectedIds} onDone={onBulkDone} />
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="No inbox items">
          <p className="text-sm text-muted-foreground">
            {filters.status || filters.sourceType || filters.platform
              ? 'Try adjusting your filters.'
              : 'New reviews and feedback will appear here.'}
          </p>
        </EmptyState>
      ) : (
        <>
          <InboxList
            items={items}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onSelectAll={onSelectAll}
            onDeselectAll={onDeselectAll}
            onRowClick={onRowClick}
          />
          {nextCursor && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => onLoadMore(nextCursor)}
              >
                {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
