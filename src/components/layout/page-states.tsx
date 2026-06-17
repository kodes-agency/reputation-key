import { AlertCircle } from 'lucide-react'
import { Skeleton } from '#/components/ui/skeleton'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'

/**
 * Standard full-page loading skeleton. Use inside a `PageShell` while route
 * data is pending or a query is fetching.
 */
export function LoadingState({ label = 'Loading…' }: Readonly<{ label?: string }>) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

/**
 * Standard full-page error with optional retry. Use inside a `PageShell` when
 * a route loader or query fails.
 */
export function ErrorState({
  message = 'Something went wrong loading this page.',
  onRetry,
}: Readonly<{ message?: string; onRetry?: () => void }>) {
  return (
    <EmptyState icon={AlertCircle} title={message}>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </EmptyState>
  )
}
