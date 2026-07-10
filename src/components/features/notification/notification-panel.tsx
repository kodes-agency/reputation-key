// Notification panel — popover with bell icon, unread badge, and notification list.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { useQueryClient } from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import {
  useUnreadNotificationCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDismissNotification,
  useDismissAllNotifications,
} from './notification-queries'
import type { NotificationServerFns } from './types'
import { getNotificationUrl } from './notification-utils'
import { NotificationPopoverContent } from './notification-popover-content'
import type { Notification } from '#/contexts/notification/application/public-api'

// Screen-reader live region announcing the unread count.
function NotificationAriaLive({ count }: Readonly<{ count: number }>) {
  return (
    <span aria-live="polite" className="sr-only">
      {count > 0
        ? `${count} unread notification${count === 1 ? '' : 's'}`
        : 'No unread notifications'}
    </span>
  )
}

// Owns panel state + mutation handlers so the component stays declarative.
function useNotificationPanel(notificationFns: NotificationServerFns) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { count } = useUnreadNotificationCount(notificationFns.getUnreadCount)
  const {
    notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    refetch: refetchList,
    loadMore,
  } = useNotifications(notificationFns.getList, 20)
  const markRead = useMarkNotificationRead(notificationFns.markRead)
  const markAllRead = useMarkAllNotificationsRead(notificationFns.markAllRead)
  const dismiss = useDismissNotification(notificationFns.dismiss)
  const dismissAll = useDismissAllNotifications(notificationFns.dismissAll)

  const refresh = () => qc.invalidateQueries({ queryKey: notificationKeys.all })

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) void refresh()
  }

  const handleNotificationClick = (n: Notification) => {
    setOpen(false)
    void navigate({ to: getNotificationUrl(n.resourceType, n.resourceId) })
  }

  const handleMarkAllRead = async () => {
    await markAllRead({ data: undefined })
    await refresh()
  }

  const handleMarkRead = async (id: string) => {
    await markRead({ data: { notificationId: id } })
    await refresh()
  }

  const handleDismiss = async (id: string) => {
    await dismiss({ data: { notificationId: id } })
    await refresh()
  }
  const handleClearAll = async () => {
    await dismissAll({ data: undefined })
    await refresh()
  }

  return {
    open,
    count,
    notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    isMarkingAllRead: markAllRead.isPending,
    isClearingAll: dismissAll.isPending,
    refetchList,
    loadMore,
    handleOpenChange,
    handleNotificationClick,
    handleMarkAllRead,
    handleMarkRead,
    handleDismiss,
    handleClearAll,
  }
}

export function NotificationPanel({
  notificationFns,
}: Readonly<{ notificationFns: NotificationServerFns }>) {
  const panel = useNotificationPanel(notificationFns)

  return (
    <Popover open={panel.open} onOpenChange={panel.handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={`Notifications${panel.count > 0 ? `, ${panel.count} unread` : ''}`}
        >
          <Bell className="size-4" />
          {panel.count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {panel.count > 9 ? '9+' : panel.count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <NotificationAriaLive count={panel.count} />
      <PopoverContent align="end" className="w-80 p-0">
        <NotificationPopoverContent
          notifications={panel.notifications}
          isLoading={panel.isLoading}
          isLoadingMore={panel.isLoadingMore}
          error={panel.error}
          hasMore={panel.hasMore}
          unreadCount={panel.count}
          isMarkingAllRead={panel.isMarkingAllRead}
          isClearingAll={panel.isClearingAll}
          onRetry={() => void panel.refetchList()}
          onLoadMore={() => void panel.loadMore()}
          onMarkAllRead={() => void panel.handleMarkAllRead()}
          onClearAll={() => void panel.handleClearAll()}
          onMarkRead={(id) => void panel.handleMarkRead(id)}
          onDismiss={(id) => void panel.handleDismiss(id)}
          onNotificationClick={panel.handleNotificationClick}
        />
      </PopoverContent>
    </Popover>
  )
}
