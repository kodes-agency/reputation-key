import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { Plus, Target } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { listGoalPrograms } from '#/contexts/reporting/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { buildGoalResultsMatrix } from '#/contexts/reporting/application/public-api'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Button } from '#/components/ui/button'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { EmptyState } from '#/components/ui/empty-state'
import { StatusBadge } from '#/components/ui/status-badge'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'
import { GOAL_STATUS } from '#/components/goals/goal-status'
import { GoalResultsMatrix } from '#/components/goals/goal-results-matrix'
import { GoalViewTabs } from '#/components/goals/goal-view-tabs'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { goalForResult } from './-goal-for-result'

const goalsSearchSchema = z.object({
  view: z.enum(['active', 'history']).default('active'),
  // A goal notice's monthly result (notificationLink): open its goal.
  result: z.string().optional(),
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
  staticData: { page: { title: 'Goals', tier: 'dashboard', under: 'property' } },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // BOTH gates, because the loader below calls a manager API that enforces
    // both. `goal.read` alone admits Staff, whose read is then refused with
    // "This account is not enabled for beta manager access" — after the route
    // has already committed to rendering, so the refusal arrives as an uncaught
    // error on a half-built page instead of a redirect.
    if (!can(role, 'goal.read') || !isBetaInteractiveRole(role)) {
      throw roleUnavailable('Goals', 'properties')
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
  const { view, result } = Route.useSearch()
  const { can: canDo } = usePermissions()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
  const goalId = result === undefined ? null : goalForResult(data.programs, result)
  if (goalId !== null) {
    return (
      <Navigate
        to="/properties/$propertyId/goals/$goalId"
        params={{ propertyId, goalId }}
        replace
      />
    )
  }
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
    <PageShell tier="dashboard">
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
                <Plus /> New Goal
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4">
        <GoalViewTabs propertyId={propertyId} view={view} />
        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title={view === 'active' ? 'No active goals' : 'No goal history'}
          />
        ) : (
          <DataTable
            label={view === 'active' ? 'Active goals' : 'Goal history'}
            from="3xl"
          >
            <DataTableHeader>
              <DataTableHead>Goal</DataTableHead>
              <DataTableHead className="w-40">Status</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {goals.map(({ program, version, assignments }) => {
                const currentAssignmentCount = assignments.filter(
                  (assignment) => assignment.programVersionId === version.id,
                ).length
                return (
                  <DataTableRow key={program.id}>
                    <DataTableCell className="min-w-0 whitespace-normal">
                      <Link
                        className={cn('font-medium', ROW_NAME_LINK)}
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
                    </DataTableCell>
                    <DataTableCell className="col-start-2 row-start-1 justify-self-end">
                      <StatusBadge status={program.status} map={GOAL_STATUS} />
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
            </DataTableBody>
          </DataTable>
        )}
      </div>
      {canDo('goal.update') ? <GoalResultsMatrix matrix={matrix} /> : null}
    </PageShell>
  )
}
