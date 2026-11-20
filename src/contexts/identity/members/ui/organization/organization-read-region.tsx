import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'

export function OrganizationReadRegion<T>({
  query,
  label,
  children,
}: Readonly<{
  query: UseQueryResult<T>
  label: string
  children: (data: T) => ReactNode
}>) {
  if (query.data === undefined && hasFailed(query))
    return (
      <RegionError
        message={`The ${label} couldn’t be loaded.`}
        onRetry={() => {
          void query.refetch()
        }}
        retrying={isRetrying(query)}
      />
    )
  if (query.data === undefined)
    return (
      <div role="status" aria-label={`Loading ${label}`}>
        <Skeleton className="h-24 w-full" />
      </div>
    )
  return children(query.data)
}
