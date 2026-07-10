// Notification popover — list-state rendering (error/loading/empty/list) + pagination.
// Selects which state to render via early returns (no chained ternary).

import { Inbox, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { NotificationRow } from './notification-row'
import type { Notification } from '#/contexts/notification/application/public-api'

type ListStateProps = Readonly<{
  notifications: readonly Notification[]
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  onRetry: () => void
  onLoadMore: () => void
  onDismiss: (id: string) => void
  onMarkRead: (id: string) => void
  onNotificationClick: (n: Notification) => void
}>

function NotificationErrorState({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-3" />
        Retry
      </Button>
    </div>
  )
}

function NotificationLoadingState() {
  return (
    <div className="flex flex-col py-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

function NotificationSection({
  label,
  notifications,
  onDismiss,
  onMarkRead,
  onNotificationClick,
}: Readonly<{
  label: string
  notifications: readonly Notification[]
  onDismiss: (id: string) => void
  onMarkRead: (id: string) => void
  onNotificationClick: (n: Notification) => void
}>) {
  return (
    <div className="flex flex-col">
      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {notifications.map((n) => (
        <NotificationRow
          key={n.id}
          notification={n}
          onRead={onMarkRead}
          onDismiss={onDismiss}
          onClick={onNotificationClick}
        />
      ))}
    </div>
  )
}

function NotificationList({
  notifications,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onDismiss,
  onMarkRead,
  onNotificationClick,
}: ListStateProps) {
  const unread = notifications.filter((n) => n.status === 'unread')
  const read = notifications.filter((n) => n.status === 'read')

  return (
    <div className="flex flex-col py-1">
      {unread.length > 0 && (
        <NotificationSection
          label="New"
          notifications={unread}
          onDismiss={onDismiss}
          onMarkRead={onMarkRead}
          onNotificationClick={onNotificationClick}
        />
      )}
      {read.length > 0 && (
        <NotificationSection
          label="Earlier"
          notifications={read}
          onDismiss={onDismiss}
          onMarkRead={onMarkRead}
          onNotificationClick={onNotificationClick}
        />
      )}
      {hasMore && (
        <div className="px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-full text-xs text-muted-foreground"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="size-3 animate-spin" />
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

// Selects which list state to render via early returns (no chained ternary).
export function NotificationListBody(props: ListStateProps) {
  if (props.error) return <NotificationErrorState onRetry={props.onRetry} />
  if (props.isLoading) return <NotificationLoadingState />
  if (props.notifications.length === 0) {
    return (
      <div className="py-6">
        <EmptyState icon={Inbox} title="You're all caught up" />
      </div>
    )
  }
  return <NotificationList {...props} />
}
