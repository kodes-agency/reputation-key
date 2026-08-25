// The full notification surface at /notifications.
//
// The bell popover is a quick view; this is the history: every filter, rows
// grouped per property, and bulk actions that are too destructive to sit in a
// popover header alone.
//
// Honest scope note: the server excludes DISMISSED rows and rows whose category
// the user opted out of in-app, so "all" means every notification still
// addressed to you — not an audit log. The description says so rather than
// implying a completeness the endpoint does not provide.

import { useMemo } from 'react'
import { CheckCheck, Settings2, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import {
  useNotificationFormat,
  useNotifications,
  useUnreadNotificationCount,
} from './notification-queries'
import { useNotificationMutations } from './notification-mutations'
import { NotificationAnnouncer, useNotificationAnnouncer } from './notification-announcer'
import { NotificationFilterTabs } from './notification-filter-tabs'
import { NotificationListBody } from './notification-list-body'
import { groupByProperty, type NotificationFilter } from './notification-filters'
import type { NotificationRowActions, NotificationServerFns } from './types'

const PAGE_SIZE = 50

type Props = Readonly<{
  notificationFns: NotificationServerFns
  organizationId: string
  /** Supplies group headings, so a property never appears as a bare UUID. */
  properties: ReadonlyArray<Readonly<{ id: string; name: string }>>
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
}>

export function NotificationPage({
  notificationFns,
  organizationId,
  properties,
  filter,
  onFilterChange,
}: Props) {
  const { announcement, announce } = useNotificationAnnouncer()
  const { count } = useUnreadNotificationCount(
    notificationFns.getUnreadCount,
    organizationId,
  )
  const list = useNotifications(
    notificationFns.getList,
    organizationId,
    PAGE_SIZE,
    filter,
    true,
  )
  const format = useNotificationFormat(notificationFns.getUserSettings, organizationId)
  const mutations = useNotificationMutations(
    notificationFns,
    organizationId,
    announce,
    PAGE_SIZE,
    filter,
  )

  const propertyNames = useMemo(
    () => Object.fromEntries(properties.map((property) => [property.id, property.name])),
    [properties],
  )
  const groups = useMemo(
    () => groupByProperty(list.notifications, propertyNames),
    [list.notifications, propertyNames],
  )

  // Following a row's CTA marks it read, exactly as it does in the popover —
  // there is just no surface to close here.
  const actions: NotificationRowActions = {
    ...mutations,
    onActivate: (notification) => {
      if (notification.status === 'unread') mutations.onMarkRead(notification.id)
    },
  }

  return (
    <PageShell>
      <PageHeader
        title="Notifications"
        description="Everything still addressed to you, newest first. Dismissed items and muted categories are not listed."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={mutations.markAllRead}
              disabled={mutations.isMarkingAllRead || count === 0}
            >
              <CheckCheck aria-hidden="true" />
              Mark all read
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={mutations.clearAll}
              disabled={mutations.isClearingAll || list.notifications.length === 0}
            >
              <Trash2 aria-hidden="true" />
              Clear all
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/settings/notifications">
                <Settings2 aria-hidden="true" />
                Preferences
              </Link>
            </Button>
          </div>
        }
      />
      <NotificationAnnouncer announcement={announcement} />
      <NotificationFilterTabs value={filter} onChange={onFilterChange} className="mt-6">
        <NotificationListBody
          groups={groups}
          isLoading={list.isLoading}
          isLoadingMore={list.isLoadingMore}
          error={list.error}
          hasMore={list.hasMore}
          onRetry={list.refetch}
          onLoadMore={list.loadMore}
          actions={actions}
          format={format}
          headingLevel={2}
          emptyTitle={
            filter === 'all'
              ? "You're all caught up"
              : 'Nothing matches this filter right now'
          }
        />
      </NotificationFilterTabs>
    </PageShell>
  )
}
