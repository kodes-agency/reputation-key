import { useState } from 'react'
import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Target } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { buildGoalResultsMatrix } from '#/contexts/reporting/application/public-api'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { AddActionLink } from '#/components/ui/add-action'
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
import { goalMetricLabel } from '#/components/goals/goal-metric-label'
import { goalListTarget } from '#/components/goals/goal-month-target-view'
import { GoalResultsMatrix } from '#/components/goals/goal-results-matrix'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import { GoalViewTabs } from '#/components/goals/goal-view-tabs'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { formatShortDate } from '#/lib/format'
import { goalForResult } from './-goal-for-result'
import { goalListSearchSchema } from './-goal-list-search'
import { goalProgramsQuery, goalSubjectNamesQuery } from './-goal-queries'

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
  validateSearch: goalListSearchSchema,
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(goalProgramsQuery(propertyId)),
      context.queryClient.ensureQueryData(goalSubjectNamesQuery(propertyId)),
    ])
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { view, result } = Route.useSearch()
  const { can: canDo } = usePermissions()
  const [now] = useState(() => new Date())
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalProgramsQuery(propertyId))
  const { data: subjectNames } = useSuspenseQuery(goalSubjectNamesQuery(propertyId))
  // Who changed a month's target, by name, for the matrix. A side read that
  // never holds the page back: until it is read, the change is told without one.
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
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
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName: propData.property.name },
          NAV_LABEL.goals,
        )}
        actions={
          canDo('goal.create') ? (
            <>
              {/* The table on the New goal page: one number per Portal, a goal each. */}
              <Button asChild variant="outline">
                <Link
                  to="/properties/$propertyId/goals/new"
                  params={{ propertyId }}
                  search={{ mode: 'several' }}
                >
                  Set goals for several portals
                </Link>
              </Button>
              <AddActionLink
                to="/properties/$propertyId/goals/new"
                params={{ propertyId }}
              >
                New goal
              </AddActionLink>
            </>
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
              {goals.map((goal) => {
                const { program, version, assignments } = goal
                const currentAssignmentCount = assignments.filter(
                  (assignment) => assignment.programVersionId === version.id,
                ).length
                // This month's target while a month runs, with its marker when
                // it was changed; "set on" ends the row only where the target's
                // own text does not already say when.
                const calendar = { timezone: version.propertyTimezone, now }
                const target = goalListTarget(
                  goal,
                  monthTargetPlan(goal, now, propData.property.timezone),
                  calendar,
                )
                const setOn =
                  target.setAt === null
                    ? ''
                    : ` · set on ${formatShortDate(target.setAt, calendar.timezone, now) ?? 'an unknown date'}`
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
                        {goalMetricLabel(target.metric)} · {target.text} ·{' '}
                        {currentAssignmentCount}{' '}
                        {currentAssignmentCount === 1 ? 'subject' : 'subjects'}
                        {setOn}
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
      {canDo('goal.update') ? (
        <GoalResultsMatrix
          matrix={matrix}
          now={now}
          personName={goalPersonNames(members.data?.members)}
        />
      ) : null}
    </PageShell>
  )
}
