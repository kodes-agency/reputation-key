import type { UseQueryResult } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'

/** What a section needs of one read: its answer, and what it takes to say it failed and to try again. */
export type SectionRead<T = unknown> = Pick<
  UseQueryResult<T>,
  'isError' | 'isFetching' | 'errorUpdateCount' | 'data' | 'refetch'
>

type Read = SectionRead

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
