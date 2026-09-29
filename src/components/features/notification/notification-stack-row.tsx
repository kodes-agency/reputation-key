// A stack of same-kind arrivals at one Property: "3 new reviews".
//
// Laid out like a notification row — the whole row is the link, one facts
// line, the menu its one sibling control — but it opens the Property's Inbox
// queue for that kind (D5), where the items are worked, and following it marks
// every row in it read. Its menu acts on all of them at once.

import { createElement } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'
import {
  isStillWaiting,
  type NotificationView,
} from '#/contexts/feed/application/public-api'
import {
  DEFAULT_NOTIFICATION_FORMAT,
  formatAbsoluteTime,
  formatCompactTime,
  formatRelativeTime,
  getNotificationIcon,
  type NotificationFormat,
} from './notification-utils'
import { notificationStackView } from './notification-stacks'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  /** Newest first; at least two. */
  notifications: ReadonlyArray<NotificationView>
  actions: NotificationRowActions
  format?: NotificationFormat
  showProperty?: boolean
}>

export function NotificationStackRow({
  notifications,
  actions,
  format = DEFAULT_NOTIFICATION_FORMAT,
  showProperty = true,
}: Props) {
  const newest = notifications[0]!
  const stamp = newest.coalescedLatestAt ?? newest.createdAt
  const view = notificationStackView(notifications, {
    showProperty,
    when: formatRelativeTime(stamp, format),
  })
  const unreadIds = notifications.filter(isStillWaiting).map((row) => row.id)
  const allIds = notifications.map((row) => row.id)

  return (
    <li
      data-notification-id={newest.id}
      data-notification-state={view.isUnread ? 'unread' : 'read'}
      data-notification-stack={notifications.length}
      className="group flex items-start rounded-lg transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
    >
      <Link
        data-row-control="open"
        to="/inbox"
        search={{ queue: view.queue, propertyId: view.propertyId } as never}
        aria-label={view.accessibleName}
        onClick={() => {
          // Following it is following its newest row — which closes the bell —
          // and it marks the rest of the stack read with it.
          actions.onActivate(newest)
          const rest = unreadIds.filter((id) => id !== newest.id)
          if (rest.length > 0) actions.onMarkManyRead(rest)
        }}
        className="flex min-w-0 flex-1 gap-3 rounded-lg py-2.5 pl-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span aria-hidden="true" className="relative mt-0.5 flex size-4 shrink-0">
          {view.isUnread && (
            <span className="absolute -left-2.5 top-1.5 size-1.5 rounded-full bg-primary" />
          )}
          {createElement(getNotificationIcon(newest.type), {
            className: cn(
              'size-4',
              view.isUnread ? 'text-foreground' : 'text-muted-foreground',
            ),
          })}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-sm leading-snug text-foreground',
              view.isUnread ? 'font-semibold' : 'font-medium',
            )}
          >
            {view.title}
          </span>
          {view.property !== null && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {view.property}
            </span>
          )}
        </span>
        <time
          dateTime={stamp.toISOString()}
          title={formatAbsoluteTime(stamp, format)}
          className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
        >
          {formatCompactTime(stamp, format)}
        </time>
      </Link>
      <span className="shrink-0 py-2 pr-1.5 pl-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-row-control="menu"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={`More actions for: ${view.accessibleName}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {unreadIds.length > 0 && (
              <DropdownMenuItem onSelect={() => actions.onMarkManyRead(unreadIds)}>
                <Check aria-hidden="true" />
                Mark all as read
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => actions.onDismissMany(allIds)}>
              <Trash2 aria-hidden="true" />
              Dismiss all {notifications.length}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  )
}
