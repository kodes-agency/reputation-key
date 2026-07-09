import { createFileRoute } from '@tanstack/react-router'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress, useImportJobPolling } from '#/components/features/integration'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState } from '#/components/layout/page-states'

export const Route = createFileRoute('/_authenticated/import/$importId')({
  staleTime: 0,
  loader: async ({ params: { importId } }) => {
    const result = await getImportStatus({ data: { importId } })
    return { job: result.job }
  },
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const initialData = Route.useLoaderData()

  // Delegated to hook — stable interval, error cap, terminal detection
  const { job, error } = useImportJobPolling(importId, initialData.job, getImportStatus)

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
