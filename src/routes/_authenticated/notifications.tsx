// /notifications — the full notification history.
//
// The bell popover was previously the ENTIRE notification surface: 320px wide,
// 320px tall, no filters, no way to look further back than the first page.
// This route is the real one; the popover links here.

import { useMemo } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { NotificationPage } from '#/components/features/notification/notification-page'
import { parseNotificationFilter } from '#/components/features/notification/notification-filters'
import { notificationFns } from '#/routes/-notification-fns'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { partitionWorkspaceProperties } from '#/components/features/property/property-workspace'
import type { AuthRouteContext } from '#/routes/_authenticated'

const authRoute = getRouteApi('/_authenticated')

// `filter` is validated permissively: an unknown value falls back to 'all'
// rather than throwing, because the tab set is derived from the domain and
// shrinks when a category stops governing any type (see
// GOVERNING_NOTIFICATION_CATEGORIES) — a bookmarked URL must not 500.
const notificationSearch = z.object({
  filter: z.string().optional().catch(undefined),
  /** The Property filter; a malformed id reads the whole feed. */
  property: z.uuid().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/notifications')({
  staticData: { page: { title: 'Notifications', tier: 'narrow' } },
  validateSearch: notificationSearch,
  staleTime: 30_000,
  component: NotificationsRoute,
})

function NotificationsRoute() {
  const context = authRoute.useRouteContext() as AuthRouteContext
  const organizationId = context.activeOrganization?.id ?? 'no-active-organization'
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: properties } = useSuspenseQuery(propertiesQuery)
  // Removed properties stay out of the choices, as they do in the navigation
  // and the Inbox.
  const workspace = useMemo(
    () => partitionWorkspaceProperties(properties.properties).workspace,
    [properties],
  )

  return (
    <NotificationPage
      notificationFns={notificationFns}
      organizationId={organizationId}
      filter={parseNotificationFilter(search.filter)}
      onFilterChange={(filter) => {
        // Filter lives in the URL so a filtered view is linkable and survives
        // a refresh. `replace` keeps the back button meaning "previous page".
        void navigate({ search: (prev) => ({ ...prev, filter }), replace: true })
      }}
      properties={workspace}
      propertyId={search.property ?? null}
      onPropertyChange={(property) => {
        void navigate({
          search: (prev) => ({ ...prev, property: property ?? undefined }),
          replace: true,
        })
      }}
    />
  )
}
