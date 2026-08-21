// List-state machine for the notification feed: error → loading → empty → list.
// Selected by early returns (no chained ternary).
//
// Real list semantics: each group is a heading + a <ul> of <li> rows, so a
// screen reader announces "list, 4 items" and supports list navigation. The
// rows used to be bare <div>s inside a <div>.

import { Inbox, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { NotificationRow } from './notification-row'
import type { NotificationGroup } from './notification-filters'
import type { NotificationFormat } from './notification-utils'
import type { NotificationRowActions } from './types'

export type NotificationListBodyProps = Readonly<{
  groups: ReadonlyArray<NotificationGroup>
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  onRetry: () => void
  onLoadMore: () => void
  actions: NotificationRowActions
  format?: NotificationFormat
  emptyTitle?: string
  /** Group-label heading level. The popover nests under an h2, the page under an h1. */
  headingLevel?: 2 | 3
}>

function NotificationErrorState({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden="true" className="size-3" />
        Retry
      </Button>
    </div>
  )
}

function NotificationLoadingState() {
  return (
    <div aria-busy="true" role="status" className="flex flex-col gap-1 py-1">
      <span className="sr-only">Loading notifications…</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function NotificationSection({
  group,
  actions,
  format,
  headingLevel,
}: Readonly<{
  group: NotificationGroup
  actions: NotificationRowActions
  format: NotificationFormat | undefined
  headingLevel: 2 | 3
}>) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <section aria-labelledby={`notification-group-${group.key}`}>
      <Heading
        id={`notification-group-${group.key}`}
        className="truncate px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground"
      >
        {group.label}
      </Heading>
      <ul className="flex flex-col gap-1">
        {group.notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            actions={actions}
            format={format}
          />
        ))}
      </ul>
    </section>
  )
}

export function NotificationListBody(props: NotificationListBodyProps) {
  if (props.error) return <NotificationErrorState onRetry={props.onRetry} />
  if (props.isLoading) return <NotificationLoadingState />
  if (props.groups.length === 0) {
    return (
      <div className="px-3 py-6">
        <EmptyState icon={Inbox} title={props.emptyTitle ?? "You're all caught up"} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      {props.groups.map((group) => (
        <NotificationSection
          key={group.key}
          group={group}
          actions={props.actions}
          format={props.format}
          headingLevel={props.headingLevel ?? 3}
        />
      ))}
      {props.hasMore && (
        <div className="px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onLoadMore}
            disabled={props.isLoadingMore}
            className="w-full text-xs text-muted-foreground"
          >
            {props.isLoadingMore ? (
              <>
                <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
