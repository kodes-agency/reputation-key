import { useQuery } from '@tanstack/react-query'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import { RegionError } from '#/components/ui/region-error'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import { StaffResultsView, StaffGoals, StaffColleagues } from './staff-results-view'
import { useStaffResults } from './use-staff-results'
import type { StaffHomeFns, StaffParticipation, StaffPeriod } from './types'

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
]

export function StaffResults({
  participation,
  period,
  onPeriod,
  fns,
}: Readonly<{
  participation: StaffParticipation
  period: StaffPeriod
  onPeriod: (period: StaffPeriod) => void
  fns: StaffHomeFns
}>) {
  const { participationId, colleagueListEnabled } = participation
  const results = useStaffResults(fns.getMyResults, participationId, period)
  const goals = useQuery({
    queryKey: staffSelfKeys.goals(participationId),
    queryFn: () => fns.getMyGoals({ data: { participationId } }),
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
  })
  const colleagues = useQuery({
    queryKey: staffSelfKeys.colleagues(participationId, period),
    queryFn: () => fns.getMyColleagues({ data: { participationId, period } }),
    enabled: colleagueListEnabled,
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
  })
  return (
    <div className="space-y-6">
      <SegmentedControl
        aria-label="Period"
        value={period}
        options={PERIODS}
        touch
        onValueChange={(value) => {
          if (value === 'today' || value === 'week' || value === 'month') onPeriod(value)
        }}
      />
      {results.isError ? (
        <RegionError
          message={actionErrorMessage(results.error)}
          onRetry={() => void results.refetch()}
          retrying={results.isFetching}
        />
      ) : results.data ? (
        <StaffResultsView period={period} results={results.data} />
      ) : (
        <Skeleton className="h-32 w-full" />
      )}
      {goals.isError ? (
        <RegionError
          message={actionErrorMessage(goals.error)}
          onRetry={() => void goals.refetch()}
          retrying={goals.isFetching}
        />
      ) : goals.data ? (
        <StaffGoals goals={goals.data.goals} />
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
      {colleagueListEnabled &&
        (colleagues.isError ? (
          <RegionError
            message={actionErrorMessage(colleagues.error)}
            onRetry={() => void colleagues.refetch()}
            retrying={colleagues.isFetching}
          />
        ) : colleagues.data ? (
          <StaffColleagues colleagues={colleagues.data.colleagues} />
        ) : (
          <Skeleton className="h-24 w-full" />
        ))}
    </div>
  )
}
