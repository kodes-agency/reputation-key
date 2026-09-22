// List-state machine for the notification feed: error → loading → empty → list.
// Selected by early returns (no chained ternary). A failure only takes over
// the list when there are no rows to keep; otherwise it is a notice beside
// them (notification-list-notices.tsx).
//
// Real list semantics: each group is a heading + a <ul> of <li> rows, so a
// screen reader announces "list, 4 items" and supports list navigation. The
// rows used to be bare <div>s inside a <div>.
//
// Every state renders inside one focusable, named group: where keyboard focus
// goes when the row holding it is removed and no row is left to move to
// (use-notification-focus-recovery.ts).

import { useRef, type ReactNode, type RefObject } from 'react'
import { Inbox } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { NotificationRow } from './notification-row'
import type { NotificationGroup } from './notification-filters'
import type { NotificationFormat } from './notification-utils'
import type { NotificationRowActions } from './types'
import { useNotificationFocusRecovery } from './use-notification-focus-recovery'
import {
  NotificationErrorState,
  NotificationLoadMore,
  NotificationRefreshNotice,
} from './notification-list-notices'

export type NotificationListBodyProps = Readonly<{
  groups: ReadonlyArray<NotificationGroup>
  isLoading: boolean
  isLoadingMore: boolean
  /** The head read failed. Rows already loaded stay listed beneath a notice. */
  error: Error | null
  /** The last "Load more" failed. */
  loadMoreError?: Error | null
  hasMore: boolean
  onRetry: () => void
  onLoadMore: () => void
  actions: NotificationRowActions
  format?: NotificationFormat
  emptyTitle?: string
  /** Group-label heading level. The popover nests under an h2, the page under an h1. */
  headingLevel?: 2 | 3
  /** The focusable list group, for a caller that must hand focus to the list. */
  listRef?: RefObject<HTMLDivElement | null>
}>

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
  const ownRef = useRef<HTMLDivElement>(null)
  const listRef = props.listRef ?? ownRef
  const rowIds = props.groups.flatMap((group) => group.notifications.map((row) => row.id))
  const focusRecovery = useNotificationFocusRecovery(listRef, rowIds)

  // Focus lands here when the bell opens, after "Mark all read", and when the
  // row holding focus goes with no row left to move to, so a keyboard user
  // must see it. The ring is inset: the popover's list scrolls, and an outer
  // ring would be clipped by it.
  return (
    <div
      ref={listRef}
      role="group"
      aria-label="Notification list"
      tabIndex={-1}
      data-notification-list=""
      className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      {...focusRecovery}
    >
      <NotificationListState {...props} />
    </div>
  )
}

function NotificationListState(props: NotificationListBodyProps): ReactNode {
  const hasRows = props.groups.length > 0
  if (props.error && !hasRows) {
    return <NotificationErrorState error={props.error} onRetry={props.onRetry} />
  }
  if (props.isLoading) return <NotificationLoadingState />
  if (!hasRows) {
    return (
      <div className="px-3 py-6">
        <EmptyState icon={Inbox} title={props.emptyTitle ?? "You're all caught up"} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      {props.error && (
        <NotificationRefreshNotice error={props.error} onRetry={props.onRetry} />
      )}
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
        <NotificationLoadMore
          isLoadingMore={props.isLoadingMore}
          error={props.loadMoreError}
          onLoadMore={props.onLoadMore}
        />
      )}
    </div>
  )
}
