import { createFileRoute, redirect, useSearch } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import { startPropertyImport } from '#/contexts/integration/server/gbp-import'
import {
  ConnectGoogleButton,
  ImportConnectedView,
} from '#/components/features/integration'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import { useAction } from '#/components/hooks/use-action'
import { ImportPageHeader } from './-import-page-header'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/properties/import/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'integration.manage')) throw redirect({ to: '/properties' })
  },
  staleTime: 60_000,
  loader: async () => {
    const result = await listGoogleConnections()
    return { connections: result.connections }
  },
  component: ImportPage,
})

function ImportPage() {
  const search = useSearch({ strict: false }) as { connectionId?: string; error?: string }
  const { connections } = Route.useLoaderData()
  const getAuthUrl = useAction(useServerFn(getGoogleAuthUrl))

  const importAction = useMutationActionSilent(startPropertyImport, {
    invalidateRoutes: ['/_authenticated'],
  })

  return (
    <PageShell>
      <ImportPageHeader showSubtitle />

      {search.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">
            {search.error === 'denied'
              ? 'Google authorization was cancelled.'
              : search.error === 'connection_failed'
                ? 'Failed to connect Google account. Please try again.'
                : 'An error occurred during Google authorization.'}
          </p>
        </div>
      )}

      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
          <p className="text-muted-foreground">No Google accounts connected yet.</p>
          <ConnectGoogleButton getAuthUrl={getAuthUrl} />
        </div>
      ) : (
        <ImportConnectedView
          connections={connections}
          initialConnectionId={search.connectionId}
          getAuthUrl={getAuthUrl}
          importAction={importAction}
        />
      )}
    </PageShell>
  )
}
