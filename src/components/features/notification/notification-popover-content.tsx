// Bell popover content: header actions, filter tabs, list, and the escape
// hatch to the full page. The popover used to BE the entire notification
// surface (max-h-80, w-80, no filters, no history); it is now the quick view.
//
// Keyboard focus starts on the list, never on "Mark all read": the panel
// points Radix's open focus at it, and when this body arrives after the
// popover opened (its chunk is lazy), the body takes over the focus the
// popover itself held meanwhile.

import { useLayoutEffect, useRef, type RefObject } from 'react'
import { CheckCheck } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { NotificationFilterTabs } from './notification-filter-tabs'
import { NotificationListBody } from './notification-list-body'
import type { NotificationFilter, NotificationGroup } from './notification-filters'
import type { NotificationFormat } from './notification-utils'
import type { NotificationRowActions } from './types'

type Props = Readonly<{
  groups: ReadonlyArray<NotificationGroup>
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  loadMoreError?: Error | null
  hasMore: boolean
  unreadCount: number
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  isMarkingAllRead: boolean
  onRetry: () => void
  onLoadMore: () => void
  onMarkAllRead: () => void
  actions: NotificationRowActions
  format?: NotificationFormat
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

export function NotificationPopoverContent(props: Props) {
  const hasAnything = props.groups.length > 0
  const listRef = useRef<HTMLDivElement>(null)
  useFocusListOnLateArrival(listRef)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {hasAnything && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={props.onMarkAllRead}
              disabled={props.isMarkingAllRead || props.unreadCount === 0}
              className="text-xs text-muted-foreground"
            >
              <CheckCheck aria-hidden="true" className="size-3" />
              Mark all read
            </Button>
          </div>
        )}
      </div>
      <Separator />
      {/* The list is the part that gives: on a short or landscape phone it
          shrinks and scrolls, so the header and the footer stay on screen.
          In the light theme it sits on the page tone, because the popover
          and an unread row's elevated surface are the same white there and
          the row's lift (DESIGN.md, Tonal Stack) measured 1.00:1. The dark
          popover already sits a step below the row. */}
      <NotificationFilterTabs
        value={props.filter}
        onChange={props.onFilterChange}
        className="min-h-0 flex-1"
        listClassName="px-2 pt-2"
        contentClassName="flex min-h-0 flex-col"
      >
        <div className="max-h-96 min-h-0 flex-1 overflow-y-auto bg-background px-1 pb-1 dark:bg-transparent">
          <NotificationListBody
            groups={props.groups}
            isLoading={props.isLoading}
            isLoadingMore={props.isLoadingMore}
            error={props.error}
            loadMoreError={props.loadMoreError}
            hasMore={props.hasMore}
            onRetry={props.onRetry}
            onLoadMore={props.onLoadMore}
            actions={props.actions}
            format={props.format}
            emptyTitle="Nothing here right now"
            listRef={listRef}
          />
        </div>
      </NotificationFilterTabs>
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
