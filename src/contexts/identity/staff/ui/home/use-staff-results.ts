import { type TenantScope } from '#/shared/queries/tenant-scope'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import {
  skipToken,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import type { StaffHomeFns, StaffPeriod, StaffResults } from './types'

export function staffResultsKey(
  scope: TenantScope,
  participationId: string,
  period: StaffPeriod,
  result: StaffResults,
) {
  return createKeys(scope).staffSelfKeys.results(
    participationId,
    period,
    result.ratingsCutoff ?? 'today',
  )
}

export async function readStaffResults(
  client: QueryClient,
  scope: TenantScope,
  read: StaffHomeFns['getMyResults'],
  participationId: string,
  period: StaffPeriod,
  signal?: AbortSignal,
) {
  const result = await read({ data: { participationId, period } })
  // Tenant teardown cancels the current read as well as removing its snapshots.
  if (!signal?.aborted)
    client.setQueryData(staffResultsKey(scope, participationId, period, result), result)
  return result
}

export function useStaffResults(
  read: StaffHomeFns['getMyResults'],
  participationId: string,
  period: StaffPeriod,
) {
  const scope = useTenantScope()
  const { staffSelfKeys } = createKeys(scope)
  const client = useQueryClient()
  // The client and RPC wrapper are dependencies of the read, not the person's cache identity.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const current = useQuery({
    queryKey: staffSelfKeys.resultsCurrent(participationId, period),
    queryFn: ({ signal }) =>
      readStaffResults(client, scope, read, participationId, period, signal),
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  })
  const snapshot = useQuery<StaffResults>({
    queryFn: skipToken,
    queryKey: staffSelfKeys.results(
      participationId,
      period,
      current.data?.ratingsCutoff ?? 'today',
    ),
    enabled: false,
  })
  return {
    data: snapshot.data,
    error: current.error,
    isError: current.isError,
    isFetching: current.isFetching,
    refetch: current.refetch,
  }
}
