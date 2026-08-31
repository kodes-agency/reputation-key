import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  getNotificationPreferencesFn,
  getNotificationUserSettingsFn,
  updateNotificationPreferenceFn,
  updateNotificationUserSettingsFn,
} from '#/contexts/notification/server/notifications'
import { NotificationsSettingsPage } from '#/components/features/settings'
import { notificationPropertyScopeKey } from '#/components/features/settings/notification-property-selection'
import { notificationKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { checkControlledRoute } from '#/shared/auth/controlled-route-check'
import type { AuthRouteContext } from '#/routes/_authenticated'

const authRoute = getRouteApi('/_authenticated')

const preferencesQuery = (organizationId: string) =>
  queryOptions({
    queryKey: notificationKeys.preferences(organizationId),
    queryFn: () => getNotificationPreferencesFn(),
    staleTime: 60_000,
  })

const userSettingsQuery = (organizationId: string) =>
  queryOptions({
    queryKey: notificationKeys.userSettings(organizationId),
    queryFn: () => getNotificationUserSettingsFn(),
    staleTime: 60_000,
  })

/** Which property's preferences are being edited. In the URL, not component
 * state: preferences are PER PROPERTY, and a reload that silently fell back to
 * "the first property by name" pointed the whole page — including its save
 * buttons — at a property the operator had not chosen. */
const notificationsSearchSchema = z.object({ propertyId: z.string().optional() })

export const Route = createFileRoute('/_authenticated/settings/notifications')({
  validateSearch: (search) => notificationsSearchSchema.parse(search),
  loader: async ({ context }) => {
    const routeContext = context as AuthRouteContext & {
      queryClient: typeof context.queryClient
    }
    const organizationId = routeContext.activeOrganization?.id ?? 'no-active-organization'
    await Promise.all([
      context.queryClient.ensureQueryData(preferencesQuery(organizationId)),
      context.queryClient.ensureQueryData(userSettingsQuery(organizationId)),
      context.queryClient.ensureQueryData(propertiesQuery),
    ])
  },
  staleTime: 60_000,
  component: NotificationsSettings,
})

function NotificationsSettings() {
  const context = authRoute.useRouteContext() as AuthRouteContext
  const organizationId = context.activeOrganization?.id ?? 'no-active-organization'
  const { data: properties } = useSuspenseQuery(propertiesQuery)

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Control property-specific in-app and email delivery."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Notifications' }]}
      />
      <NotificationSettingsPropertyScope
        key={`${organizationId}:${notificationPropertyScopeKey(properties.properties)}`}
        organizationId={organizationId}
      />
    </>
  )
}

function NotificationSettingsPropertyScope({
  organizationId,
}: Readonly<{ organizationId: string }>) {
  const { data: preferences } = useSuspenseQuery(preferencesQuery(organizationId))
  const { data: userSettings } = useSuspenseQuery(userSettingsQuery(organizationId))
  const { data: properties } = useSuspenseQuery(propertiesQuery)
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  // A propertyId in the URL wins, but only while it still names a property
  // this operator can see — a stale or hand-edited link falls back rather
  // than rendering an empty scope.
  const selected = properties.properties.find(
    (property) => property.id === search.propertyId,
  )
  const propertyId: string = selected?.id ?? properties.properties[0]?.id ?? ''
  // Explicitly `string`: the id is branded, so an inferred setter would refuse
  // the plain string the Select hands back.
  const setPropertyId = (next: string) => {
    void navigate({ search: { propertyId: next }, replace: true })
  }
  // `notification.send_email` is non-core and allowlisted per property, so the
  // answer changes with the selector. Owned here because routes own data in
  // this codebase; the view stays a pure function of its props.
  const emailCapability = useQuery({
    queryKey: notificationKeys.emailCapability(organizationId, propertyId),
    queryFn: () =>
      checkControlledRoute({
        data: {
          capability: 'notification.send_email',
          featureLabel: 'Email notifications',
          propertyId,
        },
      }),
    enabled: propertyId !== '',
    staleTime: 60_000,
  })
  const updatePreference = useActionMutation(updateNotificationPreferenceFn, {
    invalidateKeys: [notificationKeys.preferences(organizationId)],
  })
  const updateUserSettings = useActionMutation(updateNotificationUserSettingsFn, {
    invalidateKeys: [notificationKeys.userSettings(organizationId)],
  })

  return (
    <div className="mt-6 min-w-0">
      {propertyId ? (
        <NotificationsSettingsPage
          properties={properties.properties}
          preferences={preferences}
          userSettings={userSettings}
          propertyId={propertyId}
          // Strictly true only once the decision is known. Treating an
          // in-flight or failed check as "allowed" is what rendered a whole
          // column of controls that could only ever fail.
          emailAllowed={emailCapability.data?.allowed === true}
          setPropertyId={setPropertyId}
          updatePreference={updatePreference}
          updateUserSettings={updateUserSettings}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Add or request access to a property before configuring notifications.
        </p>
      )}
    </div>
  )
}
