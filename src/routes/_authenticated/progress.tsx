import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { listGoalPrograms } from '#/contexts/goal/server/goal-programs'
import { goalKeys } from '#/shared/queries/query-keys'
import { StaffGoalList } from '#/components/features/staff/staff-goal-list'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { GoalProgramBundle } from '#/contexts/goal/application/public-api'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const progressSearch = z.object({
  propertyId: z.string().uuid().optional(),
})

const staffGoalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.staff(propertyId),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: 60 * 1000,
  })

export const Route = createFileRoute('/_authenticated/progress')({
  beforeLoad: async ({ search }) => {
    await gateControlledRoute({
      data: {
        capability: 'goal.use',
        featureLabel: 'Goals',
        propertyId: search.propertyId,
      },
    })
  },
  validateSearch: progressSearch,
  loaderDeps: ({ search }) => ({ propertyId: search.propertyId }),
  loader: async ({ context, deps: { propertyId } }) => {
    if (!propertyId) {
      return { goals: [] as GoalProgramBundle[] }
    }

    const { programs } = await context.queryClient.ensureQueryData(
      staffGoalsQuery(propertyId),
    )
    return { goals: programs }
  },
  component: StaffProgressPage,
})

function StaffProgressPage() {
  const { propertyId: searchPropertyId } = Route.useSearch()
  const { data } = useQuery({
    ...staffGoalsQuery(searchPropertyId ?? '00000000-0000-4000-8000-000000000000'),
    enabled: searchPropertyId !== undefined,
  })
  const goals = data?.programs ?? []
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
