import { createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { PageHeader } from '#/components/layout/page-header'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  listGoogleConnections,
  disconnectGoogle,
  getGoogleAuthUrl,
} from '#/contexts/integration/server/google-connections'
import { IntegrationsSettingsPage } from '#/components/features/settings'

export const Route = createFileRoute('/_authenticated/settings/integrations')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'integration.manage')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async () => {
    const { connections } = await listGoogleConnections()
    return { connections }
  },
  staleTime: 60_000,
  component: IntegrationsSettings,
})

function IntegrationsSettings() {
  const { connections } = Route.useLoaderData()
  // getGoogleAuthUrl is a GET (generates a signed OAuth URL) — treat as an action
  // since it has a side effect (CSRF state) and the result drives a redirect.
  const connectGoogle = useAction(useServerFn(getGoogleAuthUrl))
  const disconnectAction = useMutationAction(disconnectGoogle, {
    successMessage: 'Google account disconnected',
    invalidateRoutes: ['/_authenticated/settings/integrations'],
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
