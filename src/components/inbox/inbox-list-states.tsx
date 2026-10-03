import { Inbox } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
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

export function InboxListError({
  error,
  onRetry,
}: Readonly<{ error: string; onRetry: () => void }>) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16">
      <p className="text-center text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

export function InboxListEmpty({
  queue,
  isFiltered,
}: Readonly<{ queue: InboxQueue; isFiltered: boolean }>) {
  const copy = inboxEmptyCopy(queue, isFiltered)
  return (
    <div className="py-12">
      <EmptyState icon={Inbox} title={copy.title}>
        {copy.description && (
          <p className="text-sm text-muted-foreground">{copy.description}</p>
        )}
      </EmptyState>
    </div>
  )
}
