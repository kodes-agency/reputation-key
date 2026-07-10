// Notification popover content — header (title + mark-all-read + clear-all)
// and list body.

import { CheckCheck, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { NotificationListBody } from './notification-list-body'
import type { Notification } from '#/contexts/notification/application/public-api'

export function NotificationPopoverContent({
  notifications,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  unreadCount,
  isMarkingAllRead,
  isClearingAll,
  onRetry,
  onLoadMore,
  onMarkAllRead,
  onClearAll,
  onDismiss,
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
  isClearingAll: boolean
  onRetry: () => void
  onLoadMore: () => void
  onMarkAllRead: () => void
  onClearAll: () => void
  onDismiss: (id: string) => void
  onMarkRead: (id: string) => void
  onNotificationClick: (n: Notification) => void
}>) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">Notifications</h3>
        {notifications.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={onMarkAllRead}
              disabled={isMarkingAllRead || unreadCount === 0}
              className="text-xs text-muted-foreground"
            >
              <CheckCheck className="size-3" />
              Mark all read
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={onClearAll}
              disabled={isClearingAll}
              className="text-xs text-muted-foreground"
            >
              <Trash2 className="size-3" />
              Clear all
            </Button>
          </div>
        )}
      </div>
      <Separator />
      <div className="max-h-80 overflow-y-auto">
        <NotificationListBody
          notifications={notifications}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          error={error}
          hasMore={hasMore}
          onRetry={onRetry}
          onLoadMore={onLoadMore}
          onDismiss={onDismiss}
          onMarkRead={onMarkRead}
          onNotificationClick={onNotificationClick}
        />
      </div>
    </>
  )
}
