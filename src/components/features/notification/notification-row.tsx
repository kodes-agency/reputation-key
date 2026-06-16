// Notification panel — single row component extracted for line-count compliance.

import {
  getNotificationIcon,
  formatRelativeTime,
  truncate,
} from './notification-utils'
import type { Notification } from '#/contexts/notification/application/public-api'

export function NotificationRow({
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
  const isUrgent = notification.priority === 'urgent'

  return (
    <button
      type="button"
      onClick={() => {
        onClick(notification)
        if (isUnread) onRead(notification.id)
      }}
      className={`flex w-full items-start gap-3 rounded-md border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 ${
        isUrgent
          ? 'border-l-destructive bg-destructive/5'
          : `border-l-transparent ${isUnread ? 'bg-accent/20' : ''}`
      }`}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium leading-tight">
            {notification.title}
          </p>
          {isUrgent && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
              Urgent
            </span>
          )}
          {isUnread && (
            <span className="flex shrink-0 items-center gap-1">
              <span className="size-2 rounded-full bg-primary" />
              <span className="sr-only">Unread</span>
            </span>
          )}
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
