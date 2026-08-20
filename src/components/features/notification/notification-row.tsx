// A single notification row.
//
// Copy is NEVER authored here. `renderNotification(type, payload)` is the one
// renderer for every channel, so this file only decides layout. The stored
// `title`/`body` snapshot is deliberately not read: rows written before the
// template layer existed said things like "Inbox item 61ed98fc-… has been
// escalated", and rendering from `type` + `payload` fixes those retroactively.
//
// Structure: the row is a heading + metadata + SIBLING controls. Nothing
// interactive is nested inside another interactive element, which is what the
// old single-<button>-wraps-everything row did.

import { X } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import {
  notificationLink,
  renderNotification,
  type Notification,
} from '#/contexts/notification/application/public-api'
import { CATEGORY_COPY } from '#/components/features/settings/notifications-type-rows'
import {
  DEFAULT_NOTIFICATION_FORMAT,
  formatAbsoluteTime,
  formatRelativeTime,
  getNotificationIcon,
  type NotificationFormat,
} from './notification-utils'
import { NotificationRowMeta } from './notification-row-meta'
import { NotificationRowMenu } from './notification-row-menu'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  notification: Notification
  actions: NotificationRowActions
  /** Persisted locale + IANA timezone. Defaults until user settings resolve. */
  format?: NotificationFormat
}>

export function NotificationRow({
  notification,
  actions,
  format = DEFAULT_NOTIFICATION_FORMAT,
}: Props) {
  const rendered = renderNotification(notification.type, notification.payload)
  const link = notificationLink(
    notification.resourceType,
    notification.resourceId,
    notification.propertyId,
  )
  const isUnread = notification.status === 'unread'
  const isUrgent = notification.priority === 'urgent'
  const Icon = getNotificationIcon(notification.type)
  const stamp = notification.coalescedLatestAt ?? notification.createdAt

  return (
    <li
      className={cn(
        // Elevation by lightness, never by shadow (DESIGN.md, Tonal Stack).
        'rounded-xl px-3 py-3 transition-colors',
        isUnread ? 'bg-surface-elevated' : 'bg-transparent',
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"
        >
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            {isUnread && (
              <>
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                />
                <span className="sr-only">Unread.</span>
              </>
            )}
            <p
              className={cn(
                'min-w-0 flex-1 text-sm leading-snug',
                isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
              )}
            >
              {rendered.title}
            </p>
            {isUrgent && <Badge variant="destructive">Urgent</Badge>}
            <time
              dateTime={stamp.toISOString()}
              title={formatAbsoluteTime(stamp, format)}
              className="shrink-0 pt-0.5 text-xs text-muted-foreground"
            >
              {formatRelativeTime(stamp, format)}
            </time>
          </div>

          {rendered.body !== '' && (
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {rendered.body}
            </p>
          )}

          <NotificationRowMeta
            payload={notification.payload}
            coalescedCount={notification.coalescedCount}
          />

          <div className="mt-2 flex items-center gap-1">
            <Button asChild size="xs" variant={isUnread ? 'default' : 'outline'}>
              {/*
                `notificationLink` returns the typed `{ path, search }` pair —
                never `'/inbox?itemId=x'` as `to`, which TanStack Router
                silently drops. The router's literal-route types cannot see a
                runtime-computed path, so the `as never` escape hatch is used
                the same way page-header.tsx does for breadcrumbs.
              */}
              <Link
                to={link.path as never}
                search={link.search as never}
                aria-label={`${rendered.actionLabel}: ${rendered.summary}`}
                onClick={() => actions.onActivate(notification)}
              >
                {rendered.actionLabel}
              </Link>
            </Button>
            <div className="ml-auto flex items-center gap-0.5">
              <NotificationRowMenu
                notification={notification}
                categoryLabel={CATEGORY_COPY[notification.category].label}
                title={rendered.title}
                actions={actions}
              />
              {/*
                Permanently visible at reduced opacity. It used to be
                `text-muted-foreground/0` revealed only by `group-hover:`, with
                no `focus-visible:` rule, so keyboard users tabbed onto an
                invisible control.
              */}
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Dismiss: ${rendered.title}`}
                onClick={() => actions.onDismiss(notification.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
