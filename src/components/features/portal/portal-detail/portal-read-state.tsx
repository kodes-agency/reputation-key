import type { UseQueryResult } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'

type Read = Pick<
  UseQueryResult,
  'isError' | 'isFetching' | 'errorUpdateCount' | 'data' | 'refetch'
>

export function PortalReadState({
  queries,
  label,
}: Readonly<{
  queries: readonly Read[]
  label: string
}>) {
  const failed = queries.filter(hasFailed)
  return failed.length > 0 ? (
    <RegionError
      message={`The ${label} couldn’t be loaded.`}
      retrying={isRetrying(queries)}
      onRetry={() => {
        void Promise.all(failed.map((query) => query.refetch()))
      }}
    />
  ) : (
    <div role="status" aria-label={`Loading ${label}`}>
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
