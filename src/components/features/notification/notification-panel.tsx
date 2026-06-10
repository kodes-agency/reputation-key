// Notification panel — popover with bell icon, unread badge, and notification list.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Separator } from '#/components/ui/separator'
import { EmptyState } from '#/components/ui/empty-state'
import {
  useUnreadNotificationCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from './notification-queries'
import {
  getNotificationUrl,
  formatRelativeTime,
  getNotificationIcon,
  truncate,
} from './notification-utils'
import type { Notification } from '#/contexts/notification/application/public-api'

// ── Single notification row ─────────────────────────────────────────

function NotificationRow({
  notification,
  onRead,
  onClick,
}: Readonly<{
  notification: Notification
  onRead: (id: string) => void
  onClick: (n: Notification) => void
}>) {
  const Icon = getNotificationIcon(notification.type)
  const isUnread = notification.status === 'unread'

  return (
    <button
      type="button"
      onClick={() => {
        onClick(notification)
        if (isUnread) onRead(notification.id)
      }}
      className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/50 ${isUnread ? 'bg-accent/20' : ''}`}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium leading-tight">
            {notification.title}
          </p>
          {isUnread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
        </div>
        {notification.body && (
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {truncate(notification.body)}
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {formatRelativeTime(notification.createdAt)}
        </p>
      </div>
    </button>
  )
}

// ── Main notification panel ─────────────────────────────────────────

export function NotificationPanel() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { count, refetch: refetchCount } = useUnreadNotificationCount()
  const { notifications, refetch: refetchList } = useNotifications(20)
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  function handleNotificationClick(n: Notification) {
    setOpen(false)
    if (n.resourceType === 'inbox_item') {
      void navigate({ to: '/inbox', search: { itemId: n.resourceId } })
    } else {
      const url = getNotificationUrl(n.resourceType, n.resourceId)
      void navigate({ to: url })
    }
  }

  async function handleMarkAllRead() {
    await markAllRead({ data: undefined })
    await Promise.all([refetchList(), refetchCount()])
  }

  async function handleMarkRead(id: string) {
    await markRead({ data: { notificationId: id } })
    void refetchCount()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative">
          <Bell className="size-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {count > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void handleMarkAllRead()}
              className="text-xs text-muted-foreground"
            >
              <CheckCheck className="size-3" />
              Mark all read
            </Button>
          )}
        </div>
        <Separator />

        {/* List */}
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-6">
              <EmptyState icon={Inbox} title="No notifications" />
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onRead={(id) => void handleMarkRead(id)}
                  onClick={handleNotificationClick}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
