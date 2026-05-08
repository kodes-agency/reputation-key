import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
// @ts-expect-error - useQuery will work with TanStack Router loaders after refactor
import { useQuery } from '@tanstack/react-query'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress } from '#/components/features/integration'
import { ImportPageHeader } from './import-page-header'

export const Route = createFileRoute('/_authenticated/properties/import/$importId')({
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const getStatus = useServerFn(getImportStatus)

  const {
    data: statusData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['import-status', importId],
    queryFn: async () => {
      const result = await getStatus({ data: { importId } })
      return result.job
    },
    // @ts-expect-error - query will have proper type after refactor
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

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div
          className="flex items-center justify-center py-12"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <div
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span>Loading import status...</span>
          </div>
        </div>
      </div>
    )
  }

  if (isError || !statusData) {
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
