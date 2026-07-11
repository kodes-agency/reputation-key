import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  listGoogleConnections,
  disconnectGoogle,
  getGoogleAuthUrl,
} from '#/contexts/integration/server/google-connections'
import { IntegrationsSettingsPage } from '#/components/features/settings'
import { integrationKeys } from '#/shared/queries/query-keys'

const connectionsQuery = queryOptions({
  queryKey: integrationKeys.connections(),
  queryFn: () => listGoogleConnections(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/settings/integrations')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'integration.manage')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async ({ context }) => {
    const { connections } = await context.queryClient.ensureQueryData(connectionsQuery)
    return { connections }
  },
  staleTime: 60_000,
  component: IntegrationsSettings,
})

function IntegrationsSettings() {
  const { data } = useSuspenseQuery(connectionsQuery)
  const connections = data.connections
  // getGoogleAuthUrl is a GET (generates a signed OAuth URL) — treat as an action
  // since it has a side effect (CSRF state) and the result drives a redirect.
  const connectGoogle = useAction(useServerFn(getGoogleAuthUrl))
  const disconnectAction = useActionMutation(disconnectGoogle, {
    successMessage: 'Google account disconnected',
    invalidateKeys: [integrationKeys.connections()],
  })

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect external accounts and services to your organization."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Integrations' }]}
      />
      <div className="mt-6">
        <IntegrationsSettingsPage
          connections={connections}
          connectGoogle={connectGoogle}
          disconnectGoogle={disconnectAction}
        />
      </div>
    </>
  )
}
