import { createFileRoute, getRouteApi, Link, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { Plus, Target } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listGoalPrograms } from '#/contexts/goal/server/goal-programs'
import { goalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'

const authRoute = getRouteApi('/_authenticated')
const goalsSearchSchema = z.object({
  view: z.enum(['active', 'history']).default('active'),
})
const goalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, model: 'program' }),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: 30_000,
  })

const metricLabel = (metric: string) => {
  switch (metric) {
    case 'qualified_scans':
      return 'Qualified scans'
    case 'portal_rating_count':
      return 'Private ratings'
    case 'portal_rating_average':
      return 'Private rating average'
    default:
      return metric
  }
}

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/')({
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }
  },
  validateSearch: goalsSearchSchema,
  loader: async ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(goalsQuery(propertyId)),
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { view } = Route.useSearch()
  const ctx = authRoute.useRouteContext() as AuthRouteContext
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const goals = data.programs.filter(({ program }) =>
    view === 'active' ? program.status !== 'ended' : program.status === 'ended',
  )

  return (
    <PageShell>
      <PageHeader
        title="Goals"
        description="Monthly targets for this property, its portal groups, and individual portals."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propData.property.name, to: `/properties/${propertyId}` },
          { label: 'Goals' },
        ]}
        actions={
          can(ctx.role, 'goal.create') ? (
            <Button asChild>
              <Link to="/properties/$propertyId/goals/new" params={{ propertyId }}>
                <Plus data-icon="inline-start" /> New Goal
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex gap-2" aria-label="Goal views">
        <Button variant={view === 'active' ? 'default' : 'outline'} asChild>
          <Link
            to="/properties/$propertyId/goals"
            params={{ propertyId }}
            search={{ view: 'active' }}
          >
            Active
          </Link>
        </Button>
        <Button variant={view === 'history' ? 'default' : 'outline'} asChild>
          <Link
            to="/properties/$propertyId/goals"
            params={{ propertyId }}
            search={{ view: 'history' }}
          >
            History
          </Link>
        </Button>
      </div>
      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title={view === 'active' ? 'No active goals' : 'No goal history'}
        />
      ) : (
        <div className="divide-y rounded-lg border">
          {goals.map(({ program, version, assignments }) => {
            const currentAssignmentCount = assignments.filter(
              (assignment) => assignment.programVersionId === version.id,
            ).length
            return (
              <div
                key={program.id}
                className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    className="font-medium hover:underline"
                    to="/properties/$propertyId/goals/$goalId"
                    params={{ propertyId, goalId: program.id }}
                  >
                    {program.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {metricLabel(version.metric)} · target {version.targetValue} ·{' '}
                    {currentAssignmentCount}{' '}
                    {currentAssignmentCount === 1 ? 'subject' : 'subjects'}
                  </p>
                </div>
                <Badge variant="outline">{program.status}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
