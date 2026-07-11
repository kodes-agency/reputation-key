import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  getNotificationPreferencesFn,
  updateNotificationPreferenceFn,
} from '#/contexts/notification/server/notifications'
import { NotificationsSettingsPage } from '#/components/features/settings'
import { notificationKeys } from '#/shared/queries/query-keys'

const preferencesQuery = queryOptions({
  queryKey: notificationKeys.preferences(),
  queryFn: () => getNotificationPreferencesFn(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/settings/notifications')({
  loader: async ({ context }) => {
    const preferences = await context.queryClient.ensureQueryData(preferencesQuery)
    return { preferences }
  },
  // Preferences change only on explicit mutation; refetch on invalidation.
  staleTime: 60_000,
  component: NotificationsSettings,
})

function NotificationsSettings() {
  const { data: preferences } = useSuspenseQuery(preferencesQuery)
  const updatePreference = useActionMutation(updateNotificationPreferenceFn, {
    successMessage: 'Preference updated',
    invalidateKeys: [notificationKeys.preferences()],
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
