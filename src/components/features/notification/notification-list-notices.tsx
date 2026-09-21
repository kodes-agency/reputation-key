// What the notification list says when a read fails.
//
// A failed refresh used to replace every row with "Couldn't load
// notifications", though the query still held the last good rows, and a failed
// "Load more" did the same to rows it never touched. An ended session looked
// like any other failure: a Retry that could never succeed. Now a failure sits
// beside the rows it leaves in place, and a 401 offers the way back in.

import { Link, useRouterState } from '@tanstack/react-router'
import { Loader2, LogIn, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { httpStatus } from '#/shared/security/expected-refusal'

/** The session ended under the open tab: signing in again is the only fix. */
export const isSessionEnded = (error: unknown): boolean => httpStatus(error) === 401

function SignInAgain() {
  const href = useRouterState({ select: (state) => state.location.href })
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/login" search={{ redirect: href }}>
        <LogIn aria-hidden="true" className="size-3" />
        Sign in again
      </Link>
    </Button>
  )
}

type FailureProps = Readonly<{ error: Error; onRetry: () => void }>

/** Nothing loaded to keep: the failure is the whole list. */
export function NotificationErrorState({ error, onRetry }: FailureProps) {
  const ended = isSessionEnded(error)
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">
        {ended ? 'Your session has ended.' : "Couldn't load notifications."}
      </p>
      {ended ? (
        <SignInAgain />
      ) : (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-3" />
          Retry
        </Button>
      )}
    </div>
  )
}

/** A refresh failed above rows that are still worth reading. */
export function NotificationRefreshNotice({ error, onRetry }: FailureProps) {
  const ended = isSessionEnded(error)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {ended ? 'Your session has ended.' : "Couldn't refresh notifications."}
      </p>
      {ended ? (
        <SignInAgain />
      ) : (
        <Button variant="ghost" size="xs" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-3" />
          Retry
        </Button>
      )}
    </div>
  )
}

type LoadMoreProps = Readonly<{
  isLoadingMore: boolean
  error: Error | null | undefined
  onLoadMore: () => void
}>

function LoadMoreLabel({ isLoadingMore, error }: Omit<LoadMoreProps, 'onLoadMore'>) {
  if (!isLoadingMore) return error ? 'Try again' : 'Load more'
  return (
    <>
      <Loader2 aria-hidden="true" className="size-3 animate-spin" />
      Loading…
    </>
  )
}

/** "Load more", and what went wrong with the last attempt, beside it. */
export function NotificationLoadMore({
  isLoadingMore,
  error,
  onLoadMore,
}: LoadMoreProps) {
  const ended = error ? isSessionEnded(error) : false
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2">
      {error && (
        <p className="text-xs text-muted-foreground">
          {ended ? 'Your session has ended.' : "Couldn't load older notifications."}
        </p>
      )}
      {ended ? (
        <SignInAgain />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="w-full text-xs text-muted-foreground"
        >
          <LoadMoreLabel isLoadingMore={isLoadingMore} error={error} />
        </Button>
      )}
    </div>
  )
}
