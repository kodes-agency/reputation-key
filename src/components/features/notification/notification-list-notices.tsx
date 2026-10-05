// What the notification list says when a read fails.
//
// A failed refresh used to replace every row with "Couldn't load
// notifications", though the query still held the last good rows, and a failed
// "Load more" did the same to rows it never touched. An ended session looked
// like any other failure: a retry that could never succeed. Now a failure sits
// beside the rows it leaves in place, and a 401 offers the way back in.

import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { LoadMoreButton } from '#/components/ui/load-more-button'
import { RegionError, RetryButton } from '#/components/ui/region-error'
import { httpStatus } from '#/shared/security/expected-refusal'

/** The session ended under the open tab: signing in again is the only fix. */
const isSessionEnded = (error: unknown): boolean => httpStatus(error) === 401

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
  return (
    <div className="px-3 py-3">
      {isSessionEnded(error) ? (
        <EmptyState
          tone="error"
          size="compact"
          icon={LogIn}
          title="Your session has ended."
          action={<SignInAgain />}
        />
      ) : (
        <RegionError
          size="compact"
          message="Notifications couldn’t be loaded."
          onRetry={onRetry}
          // A retry with no rows to keep resets the read to pending, and the list
          // shows its loading state (the list recovers focus itself).
          retrying={false}
        />
      )}
    </div>
  )
}

/**
 * A refresh failed above rows that are still worth reading. The rows keep the
 * read in its error state while it tries again, so the notice cannot see the retry
 * in the query: the button is busy from the press until the failure is a different
 * one (the read failed again) or the notice is gone (it answered).
 */
export function NotificationRefreshNotice({ error, onRetry }: FailureProps) {
  const ended = isSessionEnded(error)
  const [triedFor, setTriedFor] = useState<Error | null>(null)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {ended ? 'Your session has ended.' : 'Notifications couldn’t be refreshed.'}
      </p>
      {ended ? (
        <SignInAgain />
      ) : (
        <RetryButton
          size="xs"
          retrying={triedFor === error}
          onRetry={() => {
            setTriedFor(error)
            onRetry()
          }}
        />
      )}
    </div>
  )
}

type LoadMoreProps = Readonly<{
  isLoadingMore: boolean
  error: Error | null | undefined
  onLoadMore: () => void
}>

/**
 * "Load more", and what went wrong with the last attempt, beside it.
 *
 * While a page loads the button is busy, not disabled: a focused button that
 * becomes disabled drops focus to <body> in Chromium, outside the non-modal
 * popover. When the last page arrives and the button goes, the list's focus
 * recovery (`data-list-control`) moves focus to the list.
 */
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
          {ended ? 'Your session has ended.' : 'Older notifications couldn’t be loaded.'}
        </p>
      )}
      {ended ? (
        <SignInAgain />
      ) : (
        <LoadMoreButton
          loading={isLoadingMore}
          failed={Boolean(error)}
          onLoadMore={onLoadMore}
          data-list-control="load-more"
        />
      )}
    </div>
  )
}
