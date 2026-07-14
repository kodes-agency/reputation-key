// Inbox list panel parts — presentational sub-components + content picker,
// split from inbox-list-panel-v2.tsx for line-count compliance.

import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Cursor } from '#/contexts/inbox/application/public-api'
import { InboxListV2 } from '#/components/inbox/inbox-list-v2'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { Button } from '#/components/ui/button'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { Inbox, Loader2 } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'

export interface InboxListPanelProps {
  folderLabel: string
  openCount: number
  searchQ: string | undefined
  items: readonly InboxItem[]
  selectedIds: readonly string[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
  nextCursor: Cursor | null
  loadAction: { isPending: boolean }
  listRef: RefObject<HTMLDivElement | null>
  onSearchChange: (q: string | undefined) => void
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
  /** Opens the folder sidebar drawer (mobile only). */
  onOpenSidebar?: () => void
  onLoadMore: (cursor?: Cursor) => Promise<void>
  onBulkDone: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
}

export function InboxListSkeleton() {
  return (
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
  )
}

function InboxListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 px-4">
      <p className="text-center text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

function InboxListEmpty({ folderLabel }: { folderLabel: string }) {
  return (
    <div className="py-12">
      <EmptyState icon={Inbox} title={`No ${folderLabel.toLowerCase()} items`}>
        <p className="text-sm text-muted-foreground">
          New reviews and feedback will appear here.
        </p>
      </EmptyState>
    </div>
  )
}

/** Picks the scroll-area content (skeleton / error / empty / list). Kept as a
 *  plain function (taking the panel props) so InboxListPanel stays a thin shell. */
export function renderListContent(props: InboxListPanelProps): ReactNode {
  if (props.isLoading) return <InboxListSkeleton />
  if (props.error) return <InboxListError error={props.error} onRetry={props.onRetry} />
  if (props.items.length === 0) return <InboxListEmpty folderLabel={props.folderLabel} />
  return (
    <InboxListV2
      items={props.items}
      selectedIds={props.selectedIds}
      onToggleSelect={props.onToggleSelect}
      onSelectAll={props.onSelectAll}
      onDeselectAll={props.onDeselectAll}
      onRowClick={props.onRowClick}
    />
  )
}

/** Renders nothing until there is a next page and the initial load is done. */
export function LoadMoreButton({
  nextCursor,
  isLoading,
  loadAction,
  onLoadMore,
}: {
  nextCursor: Cursor | null
  isLoading: boolean
  loadAction: { isPending: boolean }
  onLoadMore: (cursor?: Cursor) => Promise<void>
}) {
  if (!nextCursor || isLoading) return null
  return (
    <div className="flex justify-center py-4">
      <Button
        variant="outline"
        size="sm"
        disabled={loadAction.isPending}
        onClick={() => onLoadMore(nextCursor)}
      >
        {loadAction.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
        Load more
      </Button>
    </div>
  )
}

/** The bulk-actions bar — renders nothing when no items are selected. */
export function BulkActionBar({
  selectedIds,
  items,
  onBulkDone,
  bulkUpdateFn,
}: Pick<InboxListPanelProps, 'selectedIds' | 'items' | 'onBulkDone' | 'bulkUpdateFn'>) {
  if (selectedIds.length === 0) return null
  return (
    <div className="shrink-0 border-b bg-surface px-4 py-2">
      <InboxBulkActions
        selectedIds={selectedIds}
        items={items}
        onDone={onBulkDone}
        bulkUpdateFn={bulkUpdateFn}
      />
    </div>
  )
}
