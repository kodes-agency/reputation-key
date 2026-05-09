import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress } from '#/components/features/integration'
import { ImportPageHeader } from './-import-page-header'

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
  const getStatus = useServerFn(getImportStatus)

  const { data: statusData } = useQuery({
    queryKey: ['import-status', importId],
    queryFn: async () => {
      const result = await getStatus({ data: { importId } })
      return result.job
    },
    initialData: initialData.job,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'completed' ||
        status === 'failed' ||
        status === 'completed_with_skips' ||
        status === 'completed_with_failures'
        ? false
        : 2000
    },
    staleTime: 0,
  })

  if (!statusData) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <p className="text-destructive">Import job not found or failed to load.</p>
          <Link to="/properties/import" className="text-sm text-primary hover:underline">
            Back to import
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ImportPageHeader />
      <ImportProgress job={statusData} />
    </div>
  )
}
