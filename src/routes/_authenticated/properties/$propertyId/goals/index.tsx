import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { Plus, Target } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { listGoalPrograms } from '#/contexts/goal/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { buildGoalResultsMatrix } from '#/contexts/goal/application/public-api'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import { GoalResultsMatrix } from '#/components/goals/goal-results-matrix'
import { usePermissions } from '#/shared/hooks/usePermissions'

const goalsSearchSchema = z.object({
  view: z.enum(['active', 'history']).default('active'),
})
const goalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, model: 'program' }),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: 30_000,
  })
const subjectNamesQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.goalSubjectNames(propertyId),
    queryFn: async () => {
      const [groups, portals] = await Promise.all([
        listPortalGroups({ data: { propertyId } }),
        listPortals({ data: { propertyId } }),
      ])
      return { groups: groups.groups, portals: portals.portals }
    },
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
    const { role } = context as AuthRouteContext
    // BOTH gates, because the loader below calls a manager API that enforces
    // both. `goal.read` alone admits Staff, whose read is then refused with
    // "This account is not enabled for beta manager access" — after the route
    // has already committed to rendering, so the refusal arrives as an uncaught
    // error on a half-built page instead of a redirect.
    if (!can(role, 'goal.read') || !isBetaInteractiveRole(role)) {
      throw redirect({ to: '/properties' })
    }
  },
  validateSearch: goalsSearchSchema,
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(goalsQuery(propertyId)),
      context.queryClient.ensureQueryData(subjectNamesQuery(propertyId)),
    ])
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { view } = Route.useSearch()
  const { can: canDo } = usePermissions()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
  const goals = data.programs.filter(({ program }) =>
    view === 'active' ? program.status !== 'ended' : program.status === 'ended',
  )
  const matrix = buildGoalResultsMatrix({
    programs: data.programs,
    property: { id: propertyId, name: propData.property.name },
    portalGroups: subjectNames.groups,
    portals: subjectNames.portals,
  })

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
          canDo('goal.create') ? (
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
      {canDo('goal.update') ? <GoalResultsMatrix matrix={matrix} /> : null}
    </PageShell>
  )
}
