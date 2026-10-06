import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { integrationKeys } from '#/shared/queries/query-keys'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { importFns, importSetupFns } from './-import-fns'
import { GoogleImportManager } from '#/components/features/integration/google-import-manager'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { requireGoogleImportRole } from './-route-access'

const importSearchSchema = z.object({
  connectionId: z.uuid().optional().catch(undefined),
  requestId: z.uuid().optional().catch(undefined),
  error: z
    .enum(['denied', 'connection_failed', 'account_already_connected'])
    .optional()
    .catch(undefined),
})

const connectionsQuery = queryOptions({
  queryKey: integrationKeys.connections(),
  queryFn: () => importFns.listGoogleConnections(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/properties/import-google/')({
  staticData: {
    page: {
      title: 'Import Google properties',
      under: 'properties',
    },
  },
  validateSearch: importSearchSchema,
  beforeLoad: async ({ context }) => {
    const { role } = context as AuthRouteContext
    requireGoogleImportRole(role)
    await gateControlledRoute({
      data: {
        capability: 'property.import_gbp_v2',
        featureLabel: 'Google property import',
      },
    })
  },
  staleTime: 60_000,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(connectionsQuery)
  },
  component: ImportPage,
})

function ImportPage() {
  const search = Route.useSearch()
  const { data } = useSuspenseQuery(connectionsQuery)
  const { activeOrganization, user } = Route.useRouteContext()

  return (
    <PageShell>
      <PageHeader
        title="Import Google properties"
        description="Discover, review, and import locations from Google Business Profile."
        breadcrumbs={trailCrumbs('properties', {}, 'Import Google properties')}
      />

      {search.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {search.error === 'denied'
              ? 'Google authorization was cancelled.'
              : search.error === 'account_already_connected'
                ? 'That Google account is already connected. Select it in “Connected Google account” above — you do not need to authorize again.'
                : search.error === 'connection_failed'
                  ? 'Google could not be connected. Try again.'
                  : 'Google authorization could not be completed.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <GoogleImportManager
        organizationId={activeOrganization?.id ?? 'no-active-organization'}
        connections={data.connections}
        initialConnectionId={search.connectionId}
        initialRequestId={search.requestId}
        initialError={search.error}
        importFns={importFns}
        setupFns={importSetupFns}
        viewerUserId={user.id}
      />
    </PageShell>
  )
}
