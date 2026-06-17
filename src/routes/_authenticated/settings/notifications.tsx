import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import {
  getNotificationPreferencesFn,
  updateNotificationPreferenceFn,
} from '#/contexts/notification/server/notifications'
import { NotificationsSettingsPage } from '#/components/features/settings'

export const Route = createFileRoute('/_authenticated/settings/notifications')({
  loader: async () => {
    const preferences = await getNotificationPreferencesFn()
    return { preferences }
  },
  // Preferences change only on explicit mutation; refetch on invalidation.
  staleTime: 60_000,
  component: NotificationsSettings,
})

function NotificationsSettings() {
  const { preferences } = Route.useLoaderData()
  const updatePreference = useMutationAction(updateNotificationPreferenceFn, {
    successMessage: 'Preference updated',
    invalidateRoutes: ['/_authenticated/settings/notifications'],
  })

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Control which events notify you in-app and by email."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Notifications' }]}
      />
      <div className="mt-6">
        <NotificationsSettingsPage
          preferences={preferences}
          updatePreference={updatePreference}
        />
      </div>
    </>
  )
}
