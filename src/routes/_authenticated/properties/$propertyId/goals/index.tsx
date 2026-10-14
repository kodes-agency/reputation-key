import { useState } from 'react'
import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Target } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import {
  getGoalListProgress,
  listGoalPrograms,
} from '#/contexts/reporting/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import { buildGoalResultsMatrix } from '#/contexts/reporting/application/public-api'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { AddActionLink } from '#/components/ui/add-action'
import { Button } from '#/components/ui/button'
import { SectionTitle } from '#/components/ui/section-title'
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
import { GoalLiveLine, GoalLiveLinePending } from '#/components/goals/goal-live-line'
import {
  goalListSubjectText,
  goalListSummary,
  goalLiveShape,
} from '#/components/goals/goal-live-view'
import { GoalViewTabs } from '#/components/goals/goal-view-tabs'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { formatShortDate } from '#/lib/format'
import { goalForResult } from './-goal-for-result'
import { RatingGoalPanel } from './-rating-goal-panel'
import { goalListSearchSchema } from './-goal-list-search'

const goalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.list({ propertyId, model: 'program' }),
    queryFn: () => listGoalPrograms({ data: { propertyId } }),
    staleTime: 30_000,
  })
// The month so far of the active goals, read apart from the list so a slow
// figure never holds the rows back: until it is read, a row shows what it always
// has.
const goalsLiveQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.listProgress(propertyId),
    queryFn: () => getGoalListProgress({ data: { propertyId } }),
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
      context.queryClient.ensureQueryData(goalsQuery(propertyId)),
      context.queryClient.ensureQueryData(subjectNamesQuery(propertyId)),
      // The Google section, from a module fetched on demand: its reads and their
      // server functions stay out of first paint, and a failure stays in its
      // own region.
      import('./-rating-goal-queries').then((queries) =>
        queries.prefetchRatingGoalSection(context.queryClient, propertyId),
      ),
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
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
  // Who changed a month's target, by name, for the matrix. A side read that
  // never holds the page back: until it is read, the change is told without one.
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  // Ended goals count no month, so the History view reads no figures.
  const live = useQuery({
    ...goalsLiveQuery(propertyId),
    enabled: view === 'active',
    retry: false,
  })
  const liveByProgram = new Map(live.data?.goals.map((goal) => [goal.programId, goal]))
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
        description="Your Google rating goal, and monthly targets for this property, its portal groups and its portals."
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName: propData.property.name },
          NAV_LABEL.goals,
        )}
      />
      <div className="flex flex-col gap-4">
        <GoalViewTabs propertyId={propertyId} view={view} />
        {/* The Google rating goal first, apart from the Portal goals: no shared numbers. */}
        <RatingGoalPanel
          propertyId={propertyId}
          timezone={propData.property.timezone}
          view={view}
          hasPortals={subjectNames.portals.length > 0}
        />
      </div>
      <section aria-labelledby="portal-goals-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle id="portal-goals-title">Portal goals</SectionTitle>
          {canDo('goal.create') ? (
            <div className="flex flex-wrap gap-2">
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
            </div>
          ) : null}
        </div>
        {live.isError ? (
          <p className="text-sm text-muted-foreground">
            This month’s figures can’t be read right now.
          </p>
        ) : null}
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
                    ? null
                    : `set on ${formatShortDate(target.setAt, calendar.timezone, now) ?? 'an unknown date'}`
                const liveGoal = liveByProgram.get(program.id)
                // While the month is first being read, keep the room its line
                // will take, so the rows below do not jump when it arrives.
                const pendingShape = live.isLoading
                  ? goalLiveShape({
                      status: program.status,
                      metric: target.metric,
                      subjectCount: currentAssignmentCount,
                    })
                  : null
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
                        {goalListSummary([
                          goalMetricLabel(target.metric),
                          target.text,
                          goalListSubjectText(currentAssignmentCount, liveGoal),
                          setOn,
                        ])}
                      </p>
                      {liveGoal !== undefined ? (
                        <GoalLiveLine goal={liveGoal} />
                      ) : pendingShape !== null ? (
                        <GoalLiveLinePending shape={pendingShape} />
                      ) : null}
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
      </section>
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
