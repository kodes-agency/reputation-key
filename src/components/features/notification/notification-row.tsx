// Notification panel — single row component extracted for line-count compliance.

import { X } from 'lucide-react'
import { cn } from '#/lib/utils'
import { getNotificationIcon, formatRelativeTime, truncate } from './notification-utils'
import type { Notification } from '#/contexts/notification/application/public-api'

// Left-accent + background reflect urgency and read state.
const rowClassName = (isUrgent: boolean, isUnread: boolean): string => {
  if (isUrgent && isUnread) return 'border-l-destructive bg-destructive/5'
  if (isUnread) return 'border-l-transparent bg-accent/20'
  return 'border-l-transparent'
}

// Urgent flag + unread dot, rendered inline with the title.
function NotificationRowBadges({
  isUrgent,
  isUnread,
}: Readonly<{ isUrgent: boolean; isUnread: boolean }>) {
  return (
    <>
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
    </>
  )
}

// Clickable body: icon, title + badges, body, timestamp. Opens + marks read.
function NotificationRowContent({
  notification,
  isUnread,
  onRead,
  onClick,
}: Readonly<{
  notification: Notification
  isUnread: boolean
  onRead: (id: string) => void
  onClick: (n: Notification) => void
}>) {
  const Icon = getNotificationIcon(notification.type)
  return (
    <button
      type="button"
      onClick={() => {
        onClick(notification)
        if (isUnread) onRead(notification.id)
      }}
      className="flex min-w-0 flex-1 items-start gap-3 text-left"
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              'truncate text-sm leading-tight',
              isUnread ? 'font-semibold' : 'font-normal text-muted-foreground',
            )}
          >
            {notification.title}
          </p>
          <NotificationRowBadges
            isUrgent={notification.priority === 'urgent'}
            isUnread={isUnread}
          />
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

export function NotificationRow({
  notification,
  onRead,
  onDismiss,
  onClick,
}: Readonly<{
  notification: Notification
  onRead: (id: string) => void
  onDismiss: (id: string) => void
  onClick: (n: Notification) => void
}>) {
  const isUnread = notification.status === 'unread'

  return (
    <div
      className={`group relative flex items-start rounded-md border-l-2 px-3 py-2.5 transition-colors hover:bg-accent/50 ${rowClassName(
        notification.priority === 'urgent',
        isUnread,
      )}`}
    >
      <NotificationRowContent
        notification={notification}
        isUnread={isUnread}
        onRead={onRead}
        onClick={onClick}
      />
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        aria-label="Dismiss notification"
        className="absolute right-1 top-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/0 transition-colors hover:bg-accent hover:text-muted-foreground group-hover:text-muted-foreground/70"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
