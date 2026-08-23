import { Inbox } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'

export function InboxListSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 border-b px-5 py-4">
          <Skeleton className="size-4 rounded" />
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

export function InboxListEmpty({ folderLabel }: Readonly<{ folderLabel: string }>) {
  return (
    <div className="py-12">
      <EmptyState icon={Inbox} title={`No ${folderLabel.toLowerCase()}`}>
        <p className="text-sm text-muted-foreground">
          New reviews and feedback will appear here.
        </p>
      </EmptyState>
    </div>
  )
}
