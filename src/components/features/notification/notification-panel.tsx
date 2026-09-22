// Notification bell + popover.
//
// `organizationId` is REQUIRED. It used to default to the literal
// `'no-active-organization'`, so the public-route header wrote into a different
// cache namespace than the app shell: the same signed-in user saw two different
// unread counts depending on which page they were on.
//
// The bell is on every page, /login and the guest Portal included (the public
// Header imports it even where it hides), but the popover body — rows, row
// menu, templates, filter tabs — matters only once it is opened. It is split
// out of the first-paint closure the bundle budget guards, and fetched when
// the pointer reaches the bell or the bell takes focus, so it is usually in
// place before the click. The trigger, the badge and the polling head stay
// eager.

import { lazy, Suspense, useMemo, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Skeleton } from '#/components/ui/skeleton'
import { useNotificationFormat, useNotifications } from './notification-queries'
import { useNotificationMutations } from './notification-mutations'
import { NotificationAnnouncer, useNotificationAnnouncer } from './notification-announcer'
import { groupByReadState, type NotificationFilter } from './notification-filters'
import type { NotificationServerFns, NotificationRowActions } from './types'
import type { NotificationView } from '#/contexts/feed/application/public-api'

const loadPopoverContent = () => import('./notification-popover-content')
const NotificationPopoverContent = lazy(() =>
  loadPopoverContent().then((module) => ({ default: module.NotificationPopoverContent })),
)

/** Stands in for the popover body while its chunk arrives. */
function PopoverContentFallback() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3 p-4">
      <span className="sr-only">Loading notifications…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

const PAGE_SIZE = 20
/** Half the 1rem the width cap leaves, so the popover never touches an edge. */
const POPOVER_VIEWPORT_MARGIN_PX = 8
/** The list group in the popover body (notification-list-body.tsx). */
const NOTIFICATION_LIST_SELECTOR = '[data-notification-list]'

/**
 * Radix focuses the first tabbable control on open: "Mark all read", with no
 * ring after a pointer open, so one stray Space or Enter (or a fast double
 * Enter on the bell) marked every notification read. Focus starts on the list
 * instead, where a key press changes nothing and Tab reaches the rows. While
 * the body's chunk is still loading, the popover itself holds focus and the
 * body takes it over when it arrives.
 */
function focusListOnOpen(event: Event): void {
  event.preventDefault()
  const popover = event.currentTarget
  if (!(popover instanceof HTMLElement)) return
  ;(popover.querySelector<HTMLElement>(NOTIFICATION_LIST_SELECTOR) ?? popover).focus()
}

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

  // The badge and list head are one snapshot. Polling the shared head while
  // closed keeps the bell current without a second, racing count request.
  const list = useNotifications(
    notificationFns.getFeedHead,
    notificationFns.getList,
    organizationId,
    PAGE_SIZE,
    filter,
    true,
  )
  const count = list.unreadCount
  const format = useNotificationFormat(notificationFns.getUserSettings, organizationId)
  const mutations = useNotificationMutations(notificationFns, organizationId, announce)

  const groups = useMemo(() => groupByReadState(list.notifications), [list.notifications])

  const actions: NotificationRowActions = {
    ...mutations,
    onActivate: (notification: NotificationView) => {
      setOpen(false)
      if (notification.status === 'unread') mutations.onMarkRead(notification.id)
    },
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Refetch the head, never invalidate: invalidating the org subtree used
        // to evict settings caches, while refetching the old infinite query
        // replayed every history page already loaded.
        if (next) list.refetch()
        // The bell is a quick view: it opens on All, not on the tab it closed on.
        else setFilter('all')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          onPointerEnter={() => void loadPopoverContent()}
          onFocus={() => void loadPopoverContent()}
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
          serious axe violation, so the panel names itself. It is positioned
          `fixed`, where the page cannot scroll to a clipped edge, so it is
          capped to the viewport on both axes (24rem was 64px too wide for a
          320px phone) and its list scrolls inside it, footer in reach. */}
      <PopoverContent
        align="end"
        aria-label="Notifications"
        onOpenAutoFocus={focusListOnOpen}
        collisionPadding={POPOVER_VIEWPORT_MARGIN_PX}
        className="flex max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-1rem))] flex-col p-0"
      >
        <Suspense fallback={<PopoverContentFallback />}>
          <NotificationPopoverContent
            groups={groups}
            isLoading={list.isLoading}
            isLoadingMore={list.isLoadingMore}
            error={list.error}
            loadMoreError={list.loadMoreError}
            hasMore={list.hasMore}
            filterUnreadCount={list.filterUnreadCount}
            filter={filter}
            onFilterChange={setFilter}
            isMarkingAllRead={mutations.isMarkingAllRead}
            onRetry={list.refetch}
            onLoadMore={list.loadMore}
            onMarkAllRead={() => mutations.markAllRead(filter)}
            actions={actions}
            format={format}
            onViewAll={() => setOpen(false)}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
