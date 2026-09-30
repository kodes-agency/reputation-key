// The full notification surface at /notifications.
//
// The bell popover is a quick view; this is the history, read the way the bell
// is (docs/design/notifications, D1): Needs you, most pressing first; Updates
// and All by day, on the reader's clock. One 768 px column, rows naming their
// Property, same-kind arrivals stacked, and the bulk actions that are too
// destructive to sit in a popover header alone. A reader with several
// Properties can filter to one; the bulk actions then reach only its rows.
//
// Honest scope note: the server excludes DISMISSED rows and rows whose category
// the user opted out of in-app, so "all" means every notification still
// addressed to you — not an audit log. The description says so rather than
// implying a completeness the endpoint does not provide.

import { useMemo, useRef } from 'react'
import { CheckCheck, Settings2, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { useNotificationFormat, useNotifications } from './notification-queries'
import { useNotificationMutations } from './notification-mutations'
import { NotificationAnnouncer, useNotificationAnnouncer } from './notification-announcer'
import { NotificationFilterTabs } from './notification-filter-tabs'
import { NotificationListBody } from './notification-list-body'
import {
  NotificationPropertyFilter,
  offersPropertyFilter,
} from './notification-property-filter'
import { byUrgency, groupByDay, type NotificationFilter } from './notification-filters'
import type { NotificationRowActions, NotificationServerFns } from './types'

const PAGE_SIZE = 50

const EMPTY_TITLES: Partial<Record<NotificationFilter, string>> = {
  needs_you: 'Nothing needs you right now',
  updates: 'No updates yet',
  all: "You're all caught up",
}

type Props = Readonly<{
  notificationFns: NotificationServerFns
  organizationId: string
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  /** The reader's Properties, for the filter; it is offered with two or more. */
  properties: ReadonlyArray<Readonly<{ id: string; name: string }>>
  /** The Property the page is filtered to, or null for all of them. */
  propertyId: string | null
  onPropertyChange: (propertyId: string | null) => void
}>

export function NotificationPage({
  notificationFns,
  organizationId,
  filter,
  onFilterChange,
  properties,
  propertyId,
  onPropertyChange,
}: Props) {
  // A Property the reader no longer has, or a filter they are not offered,
  // reads the whole feed, not an empty one.
  const property = offersPropertyFilter(properties)
    ? (properties.find((candidate) => candidate.id === propertyId) ?? null)
    : null
  const scope = property?.id
  const { announcement, announce } = useNotificationAnnouncer()
  const listRef = useRef<HTMLDivElement>(null)
  const dismissAllConfirmed = useRef(false)
  const list = useNotifications(
    notificationFns.getFeedHead,
    notificationFns.getList,
    organizationId,
    PAGE_SIZE,
    filter,
    true,
    scope,
  )
  const format = useNotificationFormat(notificationFns.getUserSettings, organizationId)
  const mutations = useNotificationMutations(notificationFns, organizationId, announce)

  // Needs you is one list, most pressing first; the others read by day.
  const groups = useMemo(
    () =>
      filter === 'needs_you'
        ? list.notifications.length === 0
          ? []
          : [
              {
                key: 'needs-you',
                label: 'Most pressing first',
                notifications: byUrgency(list.notifications),
              },
            ]
        : groupByDay(list.notifications, format.timeZone),
    [filter, list.notifications, format.timeZone],
  )

  // Offered while the active tab holds unread rows, and it marks only those:
  // tidying Workflow must not clear urgent Action-needed or account notices.
  // It goes once they are read, so focus moves to the list it changed.
  const offersMarkAllRead = list.filterUnreadCount > 0 && !mutations.isMarkingAllRead
  const markAllRead = () => {
    mutations.markAllRead(filter, scope)
    listRef.current?.focus()
  }

  // Following a row's CTA marks it read, exactly as it does in the popover —
  // there is just no surface to close here.
  const actions: NotificationRowActions = {
    ...mutations,
    onActivate: (notification) => {
      if (notification.status === 'unread') mutations.onMarkRead(notification.id)
    },
  }

  return (
    <PageShell tier="narrow">
      <PageHeader
        title="Notifications"
        description="What needs you comes first. Dismissed notifications and categories you muted are not listed."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {offersMarkAllRead && (
              <Button variant="outline" size="sm" onClick={markAllRead}>
                <CheckCheck aria-hidden="true" />
                Mark all read
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  // It dismisses every notification (or the filtered
                  // Property's), not this tab's, so an empty tab (Needs you,
                  // most mornings) does not disable it.
                  disabled={mutations.isDismissingAll}
                >
                  <Trash2 aria-hidden="true" />
                  Dismiss all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  if (!dismissAllConfirmed.current) return
                  dismissAllConfirmed.current = false
                  // Focus goes to the emptied list — what the action changed —
                  // rather than back to the button, and never to <body>.
                  event.preventDefault()
                  listRef.current?.focus()
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {property
                      ? `Dismiss all notifications about ${property.name}?`
                      : 'Dismiss all notifications?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {property
                      ? `This hides every notification about ${property.name} currently addressed to you. Other properties' notifications stay.`
                      : 'This hides every notification currently addressed to you.'}{' '}
                    It does not change the underlying reviews, feedback, or other work.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep notifications</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      dismissAllConfirmed.current = true
                      mutations.dismissAll(scope)
                    }}
                  >
                    Dismiss all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
      <div className="mt-6">
        <NotificationPropertyFilter
          properties={properties}
          propertyId={scope ?? null}
          onChange={onPropertyChange}
        />
      </div>
      <NotificationFilterTabs value={filter} onChange={onFilterChange} className="mt-4">
        <NotificationListBody
          groups={groups}
          isLoading={list.isLoading}
          isLoadingMore={list.isLoadingMore}
          error={list.error}
          loadMoreError={list.loadMoreError}
          hasMore={list.hasMore}
          onRetry={list.refetch}
          onLoadMore={list.loadMore}
          actions={actions}
          format={format}
          headingLevel={2}
          stack
          listRef={listRef}
          emptyTitle={EMPTY_TITLES[filter] ?? 'Nothing here right now'}
        />
      </NotificationFilterTabs>
    </PageShell>
  )
}
