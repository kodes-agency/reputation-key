import { useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import {
  getGoalListProgress,
  listGoalPrograms,
} from '#/contexts/reporting/server/goal-programs'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import { listPortals } from '#/contexts/portal/server/portals'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { InlineLink } from '#/components/ui/inline-link'
import { goalAssignmentSubjectLabel } from '#/components/goals/goal-assignment-subject-label'
import { portalNextStepOf } from '#/components/goals/rating-goal-portal-step'
import { GoalViewTabs } from '#/components/goals/goal-view-tabs'
import { PortalGoalResultsLinks } from '#/components/goals/portal-goal-results-links'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { goalForResult } from './-goal-for-result'
import { RatingGoalPanel } from './-rating-goal-panel'
import { PortalGoalExtras } from './-portal-goal-extras'
import { PortalGoalPanel } from './-portal-goal-panel'
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
      // The Google section and the Portal goals section, from one module fetched
      // on demand: their reads and server functions stay out of first paint,
      // and a failure stays in its own section.
      import('./-goals-page-prefetch').then((prefetch) =>
        prefetch.prefetchGoalsPage(
          context.queryClient,
          propertyId,
          (context as AuthRouteContext).role,
        ),
      ),
    ])
  },
  component: GoalsRoute,
})

function GoalsRoute() {
  const { propertyId } = Route.useParams()
  const { view, result, start } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { can: canDo } = usePermissions()
  const [now] = useState(() => new Date())
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
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
  const subjectName = (subject: GoalSubject) =>
    goalAssignmentSubjectLabel(
      subject,
      propData.property.name,
      subjectNames.groups,
      subjectNames.portals,
    )

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Goals"
        description="Your Google rating goal and your monthly portal goal."
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
          portalNextStep={portalNextStepOf(subjectNames.portals)}
          startOnArrival={start !== undefined}
          // Answered once: off the address, so a reload or Back does not open it again.
          onArrivalHandled={() =>
            void navigate({
              search: (prev) => ({ ...prev, start: undefined }),
              replace: true,
            })
          }
        />
      </div>
      {/* Apart from the Google section above: no shared numbers. */}
      <PortalGoalPanel
        propertyId={propertyId}
        view={view}
        extras={(monthlyGoalId) => (
          <PortalGoalExtras
            propertyId={propertyId}
            timezone={propData.property.timezone}
            view={view}
            goals={goals}
            monthlyGoalId={monthlyGoalId}
            live={{
              byProgram: liveByProgram,
              loading: live.isLoading,
              failed: live.isError,
            }}
            subjectName={subjectName}
            now={now}
          />
        )}
        empty={view === 'history' && goals.length === 0 ? 'No goal history' : undefined}
        // Each month's result and the ended goals, on their own page (R-3, R-4).
        results={
          canDo('goal.update') ? (
            <PortalGoalResultsLinks propertyId={propertyId} programs={data.programs} />
          ) : null
        }
        footer={
          canDo('goal.create') ? (
            // The way to a goal for one Portal, a group or an average (one click
            // deeper, P-5), on the New goal page until the add sheet replaces it.
            <InlineLink
              to="/properties/$propertyId/goals/new"
              params={{ propertyId }}
              className="self-start text-sm"
            >
              Add a portal goal
            </InlineLink>
          ) : null
        }
      />
    </PageShell>
  )
}
