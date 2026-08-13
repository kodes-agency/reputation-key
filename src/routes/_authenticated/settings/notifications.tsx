import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  getNotificationPreferencesFn,
  getNotificationUserSettingsFn,
  updateNotificationPreferenceFn,
  updateNotificationUserSettingsFn,
} from '#/contexts/notification/server/notifications'
import { NotificationsSettingsPage } from '#/components/features/settings'
import { notificationKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/routes/-queries/route-queries'
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

export const Route = createFileRoute('/_authenticated/settings/notifications')({
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
    return { organizationId }
  },
  staleTime: 60_000,
  component: NotificationsSettings,
})

function NotificationsSettings() {
  const context = authRoute.useRouteContext() as AuthRouteContext
  const organizationId = context.activeOrganization?.id ?? 'no-active-organization'
  const { data: preferences } = useSuspenseQuery(preferencesQuery(organizationId))
  const { data: userSettings } = useSuspenseQuery(userSettingsQuery(organizationId))
  const { data: properties } = useSuspenseQuery(propertiesQuery)
  const propertyId = properties.properties[0]?.id
  const updatePreference = useActionMutation(updateNotificationPreferenceFn, {
    invalidateKeys: [notificationKeys.preferences(organizationId)],
  })
  const updateUserSettings = useActionMutation(updateNotificationUserSettingsFn, {
    invalidateKeys: [notificationKeys.userSettings(organizationId)],
  })

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Control property-specific in-app and email delivery."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Notifications' }]}
      />
      <div className="mt-6">
        {propertyId ? (
          <NotificationsSettingsPage
            properties={properties.properties}
            preferences={preferences}
            userSettings={userSettings}
            updatePreference={updatePreference}
            updateUserSettings={updateUserSettings}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Add or request access to a property before configuring notifications.
          </p>
        )}
      </div>
    </>
  )
}
