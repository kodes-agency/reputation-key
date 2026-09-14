// Inbox list panel parts — presentational sub-components + content picker,
// split from inbox-list-panel-v2.tsx for line-count compliance.

import type {
  Cursor,
  InboxItem,
  InboxSort,
  InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { InboxListV2 } from '#/components/inbox/inbox-list-v2'
import { InboxBulkActions } from '#/components/inbox/inbox-bulk-actions'
import { Button } from '#/components/ui/button'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import type { bulkAssignInboxItemsFn } from '#/contexts/inbox/server/inbox'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { Loader2 } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import type { InboxListFilterValues } from './inbox-filters'
import { InboxListEmpty, InboxListError, InboxListSkeleton } from './inbox-list-states'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import { countActiveInboxFilters } from './inbox-filters'

export interface InboxListPanelProps {
  queue: InboxQueue
  queueLabel: string
  scopeLabel: string
  totalCount: number
  searchQ: string | undefined
  filters: InboxListFilterValues
  sort: InboxSort
  items: readonly InboxItem[]
  selectedIds: readonly string[]
  activeItemId: string | undefined
  isLoading: boolean
  error: string | null
  onRetry: () => void
  nextCursor: Cursor | null
  loadAction: { isPending: boolean }
  listRef: RefObject<HTMLDivElement | null>
  onSearchChange: (q: string | undefined) => void
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
  onLoadMore: (cursor?: Cursor) => Promise<void>
  onBulkDone: () => void
  bulkUpdateFn: typeof bulkUpdateInboxStatusFn
  bulkAssignFn: typeof bulkAssignInboxItemsFn
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  viewedUpTo: Date | null
  isCompactLayout: boolean
  selectionMode?: boolean
  onStartSelection?: () => void
  queueStrip?: ReactNode
}

/** Picks the scroll-area content (skeleton / error / empty / list). Kept as a
 *  plain function (taking the panel props) so InboxListPanel stays a thin shell. */
export function renderListContent(props: InboxListPanelProps): ReactNode {
  if (props.isLoading) return <InboxListSkeleton />
  if (props.error) return <InboxListError error={props.error} onRetry={props.onRetry} />
  if (props.items.length === 0) {
    return (
      <InboxListEmpty
        queue={props.queue}
        isFiltered={!!props.searchQ || countActiveInboxFilters(props.filters) > 0}
      />
    )
  }
  return (
    <InboxListV2
      items={props.items}
      selectedIds={props.selectedIds}
      activeItemId={props.activeItemId}
      onToggleSelect={props.onToggleSelect}
      onRowClick={props.onRowClick}
      selectionMode={props.selectionMode}
      allProperties={props.scopeLabel === 'All properties'}
      assignmentOptions={props.assignmentOptions}
      currentUser={props.currentUser}
      viewedUpTo={props.viewedUpTo}
    />
  )
}

/** Renders nothing until there is a next page and the initial load is done. */
export function LoadMoreButton({
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
      <Button
        variant="outline"
        size="sm"
        disabled={loadAction.isPending}
        onClick={() => onLoadMore(nextCursor)}
      >
        {loadAction.isPending && (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        )}
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
  bulkAssignFn,
  assignmentOptions,
  onSelectAll,
  onDeselectAll,
}: Pick<
  InboxListPanelProps,
  | 'selectedIds'
  | 'items'
  | 'onBulkDone'
  | 'bulkUpdateFn'
  | 'bulkAssignFn'
  | 'assignmentOptions'
  | 'onSelectAll'
  | 'onDeselectAll'
>) {
  if (selectedIds.length === 0) return null
  return (
    <InboxBulkActions
      selectedIds={selectedIds}
      items={items}
      onDone={onBulkDone}
      onSelectAll={onSelectAll}
      onClearSelection={onDeselectAll}
      bulkUpdateFn={bulkUpdateFn}
      bulkAssignFn={bulkAssignFn}
      assignmentOptions={assignmentOptions}
    />
  )
}
