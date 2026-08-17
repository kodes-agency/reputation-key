import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import {
  getPropertyImportV2Status,
  listImportAccounts,
  listImportCandidates,
  recoverPropertyImportV2,
  renewImportAuthorizationLease,
  retryPropertyImportItem,
  startPropertyImportV2,
} from '#/contexts/integration/server/gbp-import'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import { GoogleImportManager } from '#/components/features/integration/google-import-manager'
import { useAction } from '#/components/hooks/use-action'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { integrationKeys } from '#/shared/queries/query-keys'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

const importStatusQuery = (importId: string) =>
  queryOptions({
    queryKey: integrationKeys.import(importId),
    queryFn: () => getPropertyImportV2Status({ data: { importJobId: importId } }),
    staleTime: 0,
    retry: false,
  })

const connectionsQuery = queryOptions({
  queryKey: integrationKeys.connections(),
  queryFn: () => listGoogleConnections(),
  staleTime: 60_000,
})

export const Route = createFileRoute(
  '/_authenticated/properties/import-google/$importId',
)({
  beforeLoad: async () => {
    await gateControlledRoute({
      data: {
        capability: 'property.import_gbp_v2',
        featureLabel: 'Google property import',
      },
    })
  },
  staleTime: 0,
  loader: async ({ context, params: { importId } }) => {
    const [progress, connections] = await Promise.all([
      context.queryClient.ensureQueryData(importStatusQuery(importId)),
      context.queryClient.ensureQueryData(connectionsQuery),
    ])
    return { progress, connections: connections.connections }
  },
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const { activeOrganization } = Route.useRouteContext()
  const { data: progress } = useSuspenseQuery(importStatusQuery(importId))
  const { data: connectionData } = useSuspenseQuery(connectionsQuery)
  const getAuthUrl = useAction(useServerFn(getGoogleAuthUrl))

  return (
    <PageShell>
      <PageHeader
        title="Import progress"
        description="Track each property through the durable import workflow."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: 'Import properties', to: '/properties/import-google' },
          { label: 'Progress' },
        ]}
        backTo={{ to: '/properties/import-google', label: 'Back to import' }}
      />

      <GoogleImportManager
        organizationId={activeOrganization?.id ?? 'no-active-organization'}
        connections={connectionData.connections}
        initialProgress={progress}
        getAuthUrl={getAuthUrl}
        listAccounts={listImportAccounts}
        listCandidates={listImportCandidates}
        renewAuthorizationLease={renewImportAuthorizationLease}
        startImport={startPropertyImportV2}
        recoverImport={recoverPropertyImportV2}
        getImportStatus={getPropertyImportV2Status}
        retryImportItem={retryPropertyImportItem}
      />
    </PageShell>
  )
}
