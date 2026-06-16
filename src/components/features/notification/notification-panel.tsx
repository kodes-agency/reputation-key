// Notification panel — popover with bell icon, unread badge, and notification list.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  useUnreadNotificationCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from './notification-queries'
import { getNotificationUrl } from './notification-utils'
import { NotificationPopoverContent } from './notification-popover-content'
import type { Notification } from '#/contexts/notification/application/public-api'

export function NotificationPanel() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { count, refetch: refetchCount } = useUnreadNotificationCount()
  const {
    notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    refetch: refetchList,
    loadMore,
  } = useNotifications(20)
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      void refetchList()
      void refetchCount()
    }
  }

  function handleNotificationClick(n: Notification) {
    setOpen(false)
    void navigate({ to: getNotificationUrl(n.resourceType, n.resourceId) })
  }

  async function handleMarkAllRead() {
    await markAllRead({ data: undefined })
    await Promise.all([refetchList(), refetchCount()])
  }

  async function handleMarkRead(id: string) {
    await markRead({ data: { notificationId: id } })
    await Promise.all([refetchList(), refetchCount()])
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={`Notifications${count > 0 ? `, ${count} unread` : ''}`}
          >
            <Bell className="size-4" />
            {count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <span aria-live="polite" className="sr-only">
          {count > 0
            ? `${count} unread notification${count === 1 ? '' : 's'}`
            : 'No unread notifications'}
        </span>
        <PopoverContent align="end" className="w-80 p-0">
          <NotificationPopoverContent
            notifications={notifications}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            error={error}
            hasMore={hasMore}
            unreadCount={count}
            isMarkingAllRead={markAllRead.isPending}
            onRetry={() => void refetchList()}
            onLoadMore={() => void loadMore()}
            onMarkAllRead={() => void handleMarkAllRead()}
            onMarkRead={(id) => void handleMarkRead(id)}
            onNotificationClick={handleNotificationClick}
          />
        </PopoverContent>
      </Popover>
    </>
  )
}
