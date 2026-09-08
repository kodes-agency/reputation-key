import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { PageShell } from '#/components/layout/page-shell'

function FleetOverviewFallbackShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <PageShell tier="dashboard">
      <PageHeader title="Dashboard" description="Overview across all properties" />
      {children}
    </PageShell>
  )
}

export function FleetOverviewLoading() {
  return (
    <FleetOverviewFallbackShell>
      <LoadingState label="Loading fleet overview…" />
    </FleetOverviewFallbackShell>
  )
}

export function FleetOverviewError({ message }: Readonly<{ message?: string }>) {
  const queryClient = useQueryClient()
  return (
    <FleetOverviewFallbackShell>
      <ErrorState
        message={message}
        onRetry={() => queryClient.invalidateQueries({ queryKey: dashboardKeys.fleet() })}
      />
    </FleetOverviewFallbackShell>
  )
}
