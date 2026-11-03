import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
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
  { value: 'last_month', label: 'Last month' },
]

export function StaffResults({
  participation,
  period,
  onPeriod,
  fns,
  children,
}: Readonly<{
  participation: StaffParticipation
  period: StaffPeriod
  onPeriod: (period: StaffPeriod) => void
  fns: StaffHomeFns
  /** Beside the period: the Property switch of someone at two. */
  children?: ReactNode
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
    <>
      <div className="staff-results__controls">
        <Select
          value={period}
          onValueChange={(value) => {
            if (
              value === 'today' ||
              value === 'week' ||
              value === 'month' ||
              value === 'last_month'
            )
              onPeriod(value)
          }}
        >
          <SelectTrigger aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {children}
      </div>
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
          <StaffColleagues
            propertyName={participation.propertyName}
            colleagues={colleagues.data.colleagues}
          />
        ) : (
          <Skeleton className="h-24 w-full" />
        ))}
    </>
  )
}
