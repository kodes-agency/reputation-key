import { createFileRoute, redirect, useSearch } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { identityKeys, propertyKeys, integrationKeys } from '#/shared/queries/query-keys'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import {
  listGbpLocations,
  startPropertyImport,
} from '#/contexts/integration/server/gbp-import'
import {
  ConnectGoogleButton,
  ImportConnectedView,
} from '#/components/features/integration'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useAction } from '#/components/hooks/use-action'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

// Shared query options — the loader (ensureQueryData) and component
// (useSuspenseQuery) reference the SAME options object so the primed cache is
// hit with zero extra fetch.
const connectionsQuery = queryOptions({
  queryKey: integrationKeys.connections(),
  queryFn: () => listGoogleConnections(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/import/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'integration.manage')) throw redirect({ to: '/properties' })
  },
  staleTime: 60_000,
  loader: async ({ context }) => {
    const result = await context.queryClient.ensureQueryData(connectionsQuery)
    return { connections: result.connections }
  },
  component: ImportPage,
})

function ImportPage() {
  const search = useSearch({ strict: false }) as { connectionId?: string; error?: string }
  const { data } = useSuspenseQuery(connectionsQuery)
  const connections = data.connections
  const getAuthUrl = useAction(useServerFn(getGoogleAuthUrl))

  const importAction = useActionMutation(startPropertyImport, {
    invalidateKeys: [
      identityKeys.organizations(),
      propertyKeys.list(),
      integrationKeys.connections(),
    ],
  })

  return (
    <PageShell>
      <PageHeader
        title="Import Properties"
        description="Import properties from your Google Business Profile"
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: 'Import Properties' },
        ]}
        backTo={{ to: '/properties', label: 'Back to Properties' }}
      />

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
          listGbpLocations={listGbpLocations}
        />
      )}
    </PageShell>
  )
}
