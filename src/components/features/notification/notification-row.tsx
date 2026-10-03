// A single notification row.
//
// Copy is NEVER authored here. `renderNotification(type, payload)` is the one
// renderer for every channel, so this file only decides layout. The stored
// `title`/`body` snapshot is deliberately not read: rows written before the
// template layer existed said things like "Inbox item 61ed98fc-… has been
// escalated", and rendering from `type` + `payload` fixes those retroactively.
//
// The whole row is the link, as an Inbox row is its open button: clicking a
// notification opens what it is about and marks it read. It used to carry a
// filled button of its own as well, so every visible row was a call to action
// and the bell fitted two and a half of them. The row menu is its one sibling
// control, shown on hover and focus (always on a touch screen), so nothing
// interactive is nested inside another interactive element.
//
// The link's name is one sentence for a screen reader — the full title, the
// facts in words, when, and whether it is unread — and the detail line is its
// description.

import { createElement } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { cn } from '#/lib/utils'
import {
  notificationLink,
  type NotificationView,
} from '#/contexts/feed/application/public-api'
import { CATEGORY_COPY } from '#/components/features/settings/notifications-type-rows'
import {
  DEFAULT_NOTIFICATION_FORMAT,
  formatAbsoluteTime,
  formatCompactTime,
  formatRelativeTime,
  getNotificationIcon,
  type NotificationFormat,
} from './notification-utils'
import { NotificationRowMeta } from './notification-row-meta'
import { NotificationRowMenu } from './notification-row-menu'
import { notificationRowView, type NotificationRowTone } from './notification-row-view'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  notification: NotificationView
  actions: NotificationRowActions
  /** Persisted locale + IANA timezone. Defaults until user settings resolve. */
  format?: NotificationFormat
  /** False under a heading that already names the Property (the page's groups). */
  showProperty?: boolean
}>

const TONE_ICON_CLASS: Readonly<Record<NotificationRowTone, string>> = {
  critical: 'text-negative',
  'needs-you': 'text-foreground',
  update: 'text-muted-foreground',
  done: 'text-positive',
}

export function NotificationRow({
  notification,
  actions,
  format = DEFAULT_NOTIFICATION_FORMAT,
  showProperty = true,
}: Props) {
  const stamp = notification.coalescedLatestAt ?? notification.createdAt
  // The reader's own zone, so a Response Target's target time reads on their
  // clock; two people responsible for one item need not share one.
  const view = notificationRowView(notification, {
    timeZone: format.timeZone,
    showProperty,
    when: formatRelativeTime(stamp, format),
  })
  const link = notificationLink(
    notification.resourceType,
    notification.resourceId,
    notification.propertyId,
    notification.type,
  )
  const detailId = `notification-detail-${notification.id}`
  const icon =
    view.tone === 'done' ? CheckCircle2 : getNotificationIcon(notification.type)

  return (
    <li
      data-notification-id={notification.id}
      data-notification-state={
        view.tone === 'done' ? 'done' : view.isUnread ? 'unread' : 'read'
      }
      className="group flex items-start rounded-lg transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
    >
      {/*
        `notificationLink` returns the typed `{ path, search }` pair — never
        `'/inbox?itemId=x'` as `to`, which TanStack Router silently drops. The
        router's literal-route types cannot see a runtime-computed path, so the
        `as never` escape hatch is used the same way page-header.tsx does for
        breadcrumbs.
      */}
      <Link
        data-row-control="open"
        to={link.path as never}
        search={link.search as never}
        hash={link.hash}
        aria-label={view.accessibleName}
        aria-describedby={view.detail === '' ? undefined : detailId}
        onClick={() => actions.onActivate(notification)}
        className="flex min-w-0 flex-1 gap-3 rounded-lg py-2.5 pl-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span aria-hidden="true" className="relative mt-0.5 flex size-4 shrink-0">
          {view.isUnread && (
            <span className="absolute -left-2.5 top-1.5 size-1.5 rounded-full bg-primary" />
          )}
          {createElement(icon, { className: cn('size-4', TONE_ICON_CLASS[view.tone]) })}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-sm leading-snug',
              view.tone === 'done' && 'text-muted-foreground',
              view.tone !== 'done' && 'text-foreground',
              view.isUnread ? 'font-semibold' : 'font-medium',
            )}
          >
            {view.title}
          </span>
          <NotificationRowMeta view={view} />
          {view.detail !== '' && (
            <span
              id={detailId}
              className="mt-1 block text-xs leading-relaxed text-muted-foreground"
            >
              {view.detail}
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
        <NotificationRowMenu
          notification={notification}
          categoryLabel={CATEGORY_COPY[notification.category].label}
          title={view.fullTitle}
          actions={actions}
        />
      </span>
    </li>
  )
}
