// /notifications — the full notification history.
//
// The bell popover was previously the ENTIRE notification surface: 320px wide,
// 320px tall, no filters, no way to look further back than the first page.
// This route is the real one; the popover links here.

import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { NotificationPage } from '#/components/features/notification/notification-page'
import { parseNotificationFilter } from '#/components/features/notification/notification-filters'
import { notificationFns } from '#/routes/-notification-fns'
import type { AuthRouteContext } from '#/routes/_authenticated'

const authRoute = getRouteApi('/_authenticated')

// `filter` is validated permissively: an unknown value falls back to 'all'
// rather than throwing, because the tab set is derived from the domain and
// shrinks when a category stops governing any type (see
// GOVERNING_NOTIFICATION_CATEGORIES) — a bookmarked URL must not 500.
const notificationSearch = z.object({
  filter: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/notifications')({
  validateSearch: notificationSearch,
  staleTime: 30_000,
  component: NotificationsRoute,
})

function NotificationsRoute() {
  const context = authRoute.useRouteContext() as AuthRouteContext
  const organizationId = context.activeOrganization?.id ?? 'no-active-organization'
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <NotificationPage
      notificationFns={notificationFns}
      organizationId={organizationId}
      filter={parseNotificationFilter(search.filter)}
      onFilterChange={(filter) => {
        // Filter lives in the URL so a filtered view is linkable and survives
        // a refresh. `replace` keeps the back button meaning "previous page".
        void navigate({ search: { filter }, replace: true })
      }}
    />
  )
}
