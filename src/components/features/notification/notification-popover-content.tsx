// Notification popover content — header (title + mark-all-read) and list body.

import { CheckCheck } from 'lucide-react'
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
  onRetry,
  onLoadMore,
  onMarkAllRead,
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
  onRetry: () => void
  onLoadMore: () => void
  onMarkAllRead: () => void
  onDismiss: (id: string) => void
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
