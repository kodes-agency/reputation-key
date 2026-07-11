import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { integrationKeys } from '#/shared/queries/query-keys'
import { ImportProgress, useImportJobPolling } from '#/components/features/integration'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState } from '#/components/layout/page-states'

// Shared query options factory — importId is a route param, so the options
// are built per-request. The loader (ensureQueryData) and component
// (useSuspenseQuery) reference the SAME factory so keys match.
const importStatusQuery = (importId: string) =>
  queryOptions({
    queryKey: integrationKeys.import(importId),
    queryFn: () => getImportStatus({ data: { importId } }),
    staleTime: 0,
  })

export const Route = createFileRoute('/_authenticated/import/$importId')({
  staleTime: 0,
  loader: async ({ context, params: { importId } }) => {
    const result = await context.queryClient.ensureQueryData(importStatusQuery(importId))
    return { job: result.job }
  },
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const { data } = useSuspenseQuery(importStatusQuery(importId))

  // Delegated to hook — stable interval, error cap, terminal detection
  const { job, error } = useImportJobPolling(importId, data.job, getImportStatus)

  return (
    <PageShell>
      <PageHeader
        title="Import Progress"
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: 'Import Properties', to: '/import' },
          { label: 'Progress' },
        ]}
        backTo={{ to: '/import', label: 'Back to Import' }}
      />

      {!job ? (
        <ErrorState message="Import job not found or failed to load." />
      ) : (
        <>
          <ImportProgress job={job} />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              Lost connection to server. Showing last known status.
            </p>
          )}
        </>
      )}
    </PageShell>
  )
}
