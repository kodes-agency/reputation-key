import { Inbox } from 'lucide-react'
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import { inboxEmptyCopy } from './inbox-queues'

export function InboxListSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, index) => (
        // Phone rows start on the 16px gutter and have no selection gutter at
        // rest, so the skeleton drops its leading square there too: rows would
        // otherwise jump from x=40 to x=16 when the data arrives.
        <div
          key={index}
          className="flex h-[78px] items-center gap-3 border-b px-3 py-3 max-md:px-4"
        >
          <Skeleton className="size-4 rounded max-md:hidden" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

// Both states sit in the list pane as a compact panel: the pane is narrow, and
// the panel needs a gutter of its own so its dashed edge does not touch the pane.
export function InboxListError({
  error,
  onRetry,
  isRetrying = false,
}: Readonly<{ error: string; onRetry: () => void; isRetrying?: boolean }>) {
  return (
    <div className="p-4">
      <RegionError
        size="compact"
        message={error}
        onRetry={onRetry}
        retrying={isRetrying}
      />
    </div>
  )
}

export function InboxListEmpty({
  queue,
  isFiltered,
  searching,
  onClearFilters,
}: Readonly<{
  queue: InboxQueue
  isFiltered: boolean
  /** A search is among what narrowed the list, so Clear takes it away too. */
  searching: boolean
  onClearFilters: () => void
}>) {
  const copy = inboxEmptyCopy(queue, isFiltered)
  return (
    <div className="p-4">
      <EmptyState
        size="compact"
        icon={Inbox}
        title={copy.title}
        description={copy.description}
        // No match is recoverable: say how, as the Properties and Portals lists do.
        action={
          isFiltered ? (
            <ClearFiltersButton
              variant="outline"
              size="sm"
              searching={searching}
              onClear={onClearFilters}
            />
          ) : undefined
        }
      />
    </div>
  )
}
