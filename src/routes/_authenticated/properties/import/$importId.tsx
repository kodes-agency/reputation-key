import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress } from '#/components/features/integration'

export const Route = createFileRoute('/_authenticated/properties/import/$importId')({
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const getStatus = useServerFn(getImportStatus)

  const { data: statusData, isLoading } = useQuery({
    queryKey: ['import-status', importId],
    queryFn: async () => {
      const result = await getStatus({ data: { importId } })
      return result.job
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'completed' || status === 'failed' ? false : 2000
    },
    staleTime: 0,
  })

  const job = statusData ?? {
    id: importId,
    organizationId: '',
    initiatedBy: '',
    status: 'queued' as const,
    totalCount: 0,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span>Loading import status...</span>
          </div>
        </div>
      </div>
    )
  }

  return <ImportProgress job={job} />
}
