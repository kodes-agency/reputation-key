// Notification popover content — extracted for line-count compliance.
// Renders the header, list states (error/loading/empty/list), and pagination.

import { CheckCheck, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { NotificationRow } from './notification-row'
import type { Notification } from '#/contexts/notification/application/public-api'

export function NotificationPopoverContent({
  notifications,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  unreadCount,
  isMarkingAllRead,
  onRetry,
  onLoadMore,
  onMarkAllRead,
  onMarkRead,
  onNotificationClick,
}: Readonly<{
  notifications: readonly Notification[]
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  unreadCount: number
  isMarkingAllRead: boolean
  onRetry: () => void
  onLoadMore: () => void
  onMarkAllRead: () => void
  onMarkRead: (id: string) => void
  onNotificationClick: (n: Notification) => void
}>) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onMarkAllRead}
            disabled={isMarkingAllRead}
            className="text-xs text-muted-foreground"
          >
            <CheckCheck className="size-3" />
            Mark all read
          </Button>
        )}
      </div>
      <Separator />

      <div className="max-h-80 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3" />
              Retry
            </Button>
          </div>
        ) : isLoading ? (
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
        ) : notifications.length === 0 ? (
          <div className="py-6">
            <EmptyState icon={Inbox} title="No notifications" />
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onRead={onMarkRead}
                onClick={onNotificationClick}
              />
            ))}
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
        )}
      </div>
    </>
  )
}
