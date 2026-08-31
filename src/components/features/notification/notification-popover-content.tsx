// Bell popover content: header actions, filter tabs, list, and the escape
// hatch to the full page. The popover used to BE the entire notification
// surface (max-h-80, w-80, no filters, no history); it is now the quick view.

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

export function NotificationPopoverContent(props: Props) {
  const hasAnything = props.groups.length > 0

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
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
      <NotificationFilterTabs
        value={props.filter}
        onChange={props.onFilterChange}
        listClassName="px-2 pt-2"
      >
        <div className="max-h-96 overflow-y-auto px-1 pb-1">
          <NotificationListBody
            groups={props.groups}
            isLoading={props.isLoading}
            isLoadingMore={props.isLoadingMore}
            error={props.error}
            hasMore={props.hasMore}
            onRetry={props.onRetry}
            onLoadMore={props.onLoadMore}
            actions={props.actions}
            format={props.format}
            emptyTitle="Nothing here right now"
          />
        </div>
      </NotificationFilterTabs>
      <Separator />
      <div className="px-2 py-2">
        <Button asChild variant="ghost" size="sm" className="w-full text-xs">
          <Link to="/notifications" onClick={props.onViewAll}>
            View all notifications
          </Link>
        </Button>
      </div>
    </>
  )
}
