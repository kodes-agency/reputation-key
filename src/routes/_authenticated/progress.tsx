import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { goalKeys } from '#/shared/queries/query-keys'
import { StaffGoalList } from '#/components/features/staff/staff-goal-list'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { StaffGoalEntry } from '#/contexts/goal/application/public-api'

const progressSearch = z.object({
  propertyId: z.string().uuid().optional(),
})

const staffGoalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.staff(propertyId),
    queryFn: () => listStaffGoals({ data: { propertyId } }),
  })

export const Route = createFileRoute('/_authenticated/progress')({
  validateSearch: progressSearch,
  loaderDeps: ({ search }) => ({ propertyId: search.propertyId }),
  loader: async ({ context, deps: { propertyId } }) => {
    if (!propertyId) {
      return { goals: [] as StaffGoalEntry[] }
    }

    const { goals } = await context.queryClient.ensureQueryData(
      staffGoalsQuery(propertyId),
    )
    return { goals }
  },
  component: StaffProgressPage,
})

function StaffProgressPage() {
  const { propertyId: searchPropertyId } = Route.useSearch()
  const { data } = useQuery({
    ...staffGoalsQuery(searchPropertyId ?? ''),
    enabled: !!searchPropertyId,
  })
  const goals = data?.goals ?? []
  // No property selected — the sidebar defaults ?propertyId= on first load.
  if (!searchPropertyId) {
    return (
      <PageShell>
        <PageHeader
          title="Progress"
          description="Where you are and where you're going."
        />
        <StaffEmptyState />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="Progress" description="Where you are and where you're going." />
      <StaffGoalList goals={goals} />
    </PageShell>
  )
}
