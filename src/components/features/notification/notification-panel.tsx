// Notification bell + popover.
//
// `organizationId` is REQUIRED. It used to default to the literal
// `'no-active-organization'`, so the public-route header wrote into a different
// cache namespace than the app shell: the same signed-in user saw two different
// unread counts depending on which page they were on.

import { useMemo, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  useNotificationFormat,
  useNotifications,
  useUnreadNotificationCount,
} from './notification-queries'
import { useNotificationMutations } from './notification-mutations'
import { NotificationAnnouncer, useNotificationAnnouncer } from './notification-announcer'
import { groupByReadState, type NotificationFilter } from './notification-filters'
import { NotificationPopoverContent } from './notification-popover-content'
import type { NotificationServerFns, NotificationRowActions } from './types'
import type { Notification } from '#/contexts/notification/application/public-api'

const PAGE_SIZE = 20

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

type Props = Readonly<{
  notificationFns: NotificationServerFns
  organizationId: string
}>

export function NotificationPanel({ notificationFns, organizationId }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const { announcement, announce } = useNotificationAnnouncer()

  const { count } = useUnreadNotificationCount(
    notificationFns.getUnreadCount,
    organizationId,
  )
  // Polls only while open: the list used to go stale beside a live badge.
  const list = useNotifications(
    notificationFns.getList,
    organizationId,
    PAGE_SIZE,
    filter,
    open,
  )
  const format = useNotificationFormat(notificationFns.getUserSettings, organizationId)
  const mutations = useNotificationMutations(
    notificationFns,
    organizationId,
    announce,
    PAGE_SIZE,
    filter,
  )

  const groups = useMemo(() => groupByReadState(list.notifications), [list.notifications])

  const actions: NotificationRowActions = {
    ...mutations,
    onActivate: (notification: Notification) => {
      setOpen(false)
      if (notification.status === 'unread') mutations.onMarkRead(notification.id)
    },
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Refetch, never invalidate: invalidating the org subtree used to evict
        // the settings page's caches every time the bell was opened.
        if (next) list.refetch()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={`Notifications${count > 0 ? `, ${count} unread` : ''}`}
        >
          <Bell aria-hidden="true" className="size-4" />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <NotificationAriaLive count={count} />
      <NotificationAnnouncer announcement={announcement} />
      {/* Radix gives PopoverContent role="dialog"; an unnamed dialog is a
          serious axe violation, so the panel names itself. */}
      <PopoverContent align="end" aria-label="Notifications" className="w-96 p-0">
        <NotificationPopoverContent
          groups={groups}
          isLoading={list.isLoading}
          isLoadingMore={list.isLoadingMore}
          error={list.error}
          hasMore={list.hasMore}
          unreadCount={count}
          filter={filter}
          onFilterChange={setFilter}
          isMarkingAllRead={mutations.isMarkingAllRead}
          onRetry={list.refetch}
          onLoadMore={list.loadMore}
          onMarkAllRead={mutations.markAllRead}
          actions={actions}
          format={format}
          onViewAll={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
