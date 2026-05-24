import { createFileRoute, Link } from '@tanstack/react-router'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress, useImportJobPolling } from '#/components/features/integration'
import { ImportPageHeader } from './-import-page-header'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/properties/import/$importId')({
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
  const { job, error } = useImportJobPolling(importId, initialData.job)

  if (!job) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <p className="text-destructive">Import job not found or failed to load.</p>
          <Link to="/properties/import" className="text-sm text-primary hover:underline">
            Back to import
          </Link>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <ImportPageHeader />
      <ImportProgress job={job} />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          Lost connection to server. Showing last known status.
        </p>
      )}
    </PageShell>
  )
}
