import {
  skipToken,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import type { StaffHomeFns, StaffPeriod, StaffResults } from './types'

export function staffResultsKey(
  participationId: string,
  period: StaffPeriod,
  result: StaffResults,
) {
  return staffSelfKeys.results(participationId, period, result.ratingsCutoff ?? 'today')
}

export async function readStaffResults(
  client: QueryClient,
  read: StaffHomeFns['getMyResults'],
  participationId: string,
  period: StaffPeriod,
) {
  const result = await read({ data: { participationId, period } })
  client.setQueryData(staffResultsKey(participationId, period, result), result)
  return result
}

export function useStaffResults(
  read: StaffHomeFns['getMyResults'],
  participationId: string,
  period: StaffPeriod,
) {
  const client = useQueryClient()
  // The client and RPC wrapper are dependencies of the read, not the person's cache identity.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const current = useQuery({
    queryKey: staffSelfKeys.resultsCurrent(participationId, period),
    queryFn: () => readStaffResults(client, read, participationId, period),
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
