// Bell popover content: what needs the reader, then what happened, and the
// way to the full page (docs/design/notifications, D1).
//
// "Needs you" is the panel's polling head — the same snapshot the badge counts
// (D2) — most pressing first. "Updates" is read here, only while the bell is
// open, a few rows deep: the page holds the history. Same-kind arrivals at one
// Property stack into one row in both.
//
// Keyboard focus starts on the Needs-you list, never on "Mark all read": the
// panel points Radix's open focus at the first list, and when this body
// arrives after the popover opened (its chunk is lazy), the body takes over
// the focus the popover itself held meanwhile.

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { CheckCheck } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { NotificationListBody } from './notification-list-body'
import { byUrgency, type NotificationGroup } from './notification-filters'
import { useNotifications } from './notification-queries'
import type { NotificationFormat } from './notification-utils'
import type { NotificationRowActions, NotificationServerFns } from './types'
import type { NotificationView } from '#/contexts/feed/application/public-api'

/** How many updates the bell shows; the page has the rest. */
const UPDATES_LIMIT = 8

type NeedsYouList = Readonly<{
  notifications: ReadonlyArray<NotificationView>
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  loadMoreError?: Error | null
  hasMore: boolean
  onRetry: () => void
  onLoadMore: () => void
}>

type Props = Readonly<{
  needsYou: NeedsYouList
  /** Every row still waiting on the reader: what "Mark all read" changes. */
  unreadCount: number
  isMarkingAllRead: boolean
  onMarkAllRead: () => void
  actions: NotificationRowActions
  format?: NotificationFormat
  /** Where the Updates section reads from, while the bell is open. */
  notificationFns: NotificationServerFns
  organizationId: string
  /** Lets the panel close itself when the user leaves for the full page. */
  onViewAll?: () => void
}>

/** Takes over the focus the popover held while this body was loading. */
function useFocusListOnLateArrival(list: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const popover = list.current?.closest('[role="dialog"]')
    if (popover && document.activeElement === popover) list.current?.focus()
  }, [list])
}

const section = (
  key: string,
  label: string,
  notifications: ReadonlyArray<NotificationView>,
): ReadonlyArray<NotificationGroup> =>
  notifications.length === 0 ? [] : [{ key, label, notifications }]

export function NotificationPopoverContent(props: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  useFocusListOnLateArrival(listRef)
  const updates = useNotifications(
    props.notificationFns.getFeedHead,
    props.notificationFns.getList,
    props.organizationId,
    UPDATES_LIMIT,
    'updates',
    false,
  )
  const needsYouGroups = useMemo(
    () => section('needs-you', 'Needs you', byUrgency(props.needsYou.notifications)),
    [props.needsYou.notifications],
  )
  const updateGroups = useMemo(
    () => section('updates', 'Updates', updates.notifications),
    [updates.notifications],
  )
  // Offered only while something is unread, and gone once it is marked; focus
  // then moves to the list it changed, not to <body> outside the non-modal
  // popover.
  const offersMarkAllRead = props.unreadCount > 0 && !props.isMarkingAllRead
  const markAllRead = () => {
    props.onMarkAllRead()
    listRef.current?.focus()
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {offersMarkAllRead && (
          <Button
            variant="ghost"
            size="xs"
            onClick={markAllRead}
            className="text-xs text-muted-foreground"
          >
            <CheckCheck aria-hidden="true" className="size-3" />
            Mark all read
          </Button>
        )}
      </div>
      <Separator />
      {/* The lists are the part that gives: on a short or landscape phone they
          shrink and scroll, so the header and the footer stay on screen. */}
      <div className="max-h-[28rem] min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <NotificationListBody
          groups={needsYouGroups}
          isLoading={props.needsYou.isLoading}
          isLoadingMore={props.needsYou.isLoadingMore}
          error={props.needsYou.error}
          loadMoreError={props.needsYou.loadMoreError}
          hasMore={props.needsYou.hasMore}
          onRetry={props.needsYou.onRetry}
          onLoadMore={props.needsYou.onLoadMore}
          actions={props.actions}
          format={props.format}
          emptyTitle="Nothing needs you right now"
          compactEmpty
          stack
          listLabel="Needs you"
          listRef={listRef}
        />
        <Separator className="my-1" />
        <NotificationListBody
          groups={updateGroups}
          isLoading={updates.isLoading}
          isLoadingMore={false}
          error={updates.error}
          hasMore={false}
          onRetry={updates.refetch}
          onLoadMore={updates.loadMore}
          actions={props.actions}
          format={props.format}
          emptyTitle="No updates yet"
          compactEmpty
          stack
          listLabel="Updates"
        />
      </div>
      <Separator />
      <div className="shrink-0 px-2 py-2">
        <Button asChild variant="ghost" size="sm" className="w-full text-xs">
          <Link to="/notifications" onClick={props.onViewAll}>
            View all notifications
          </Link>
        </Button>
      </div>
    </>
  )
}
