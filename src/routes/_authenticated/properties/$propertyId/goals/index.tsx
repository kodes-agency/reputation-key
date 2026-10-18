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
import { goalAssignmentSubjectLabel } from '#/components/goals/goal-assignment-subject-label'
import { portalNextStepOf } from '#/components/goals/rating-goal-portal-step'
import { PortalGoalResultsLinks } from '#/components/goals/portal-goal-results-links'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { goalForResult } from './-goal-for-result'
import { RatingGoalPanel } from './-rating-goal-panel'
import { PortalGoalExtras } from './-portal-goal-extras'
import { PortalGoalPanel } from './-portal-goal-panel'
import { PortalGoalAddDoor } from './-portal-goal-add-host'
import { focusPortalGoalCardTitle } from './-portal-goal-sheet-host'
import { goalListSearchSchema } from './-goal-list-search'

/** How many other Portal goals the Goals page lists before "See all on the goal page". */
const EXTRAS_SHOWN = 5

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
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(goalsQuery(propertyId))
  const { data: subjectNames } = useSuspenseQuery(subjectNamesQuery(propertyId))
  // The month so far of the Portal goals not ended, which both of the Google
  // section's views list the same.
  const live = useQuery({ ...goalsLiveQuery(propertyId), retry: false })
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
  // `?view=` is the Google section's (P-7a): the Portal goals are the same on
  // both views, and the ended ones are on the Portal goal results page (`#ended`).
  const goals = data.programs.filter(({ program }) => program.status !== 'ended')
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
      {/* The Google rating goal first, with its own tabs, apart from the Portal goals: no shared numbers. */}
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
      {/* Apart from the Google section above: no shared numbers. */}
      <PortalGoalPanel
        propertyId={propertyId}
        extras={(monthlyGoalId) => (
          <PortalGoalExtras
            propertyId={propertyId}
            goals={goals}
            monthlyGoalId={monthlyGoalId}
            live={{
              byProgram: liveByProgram,
              loading: live.isLoading,
              failed: live.isError,
            }}
            subjectName={subjectName}
            // Compact rows, then "See all on the goal page" (PLAN PG-21).
            limit={EXTRAS_SHOWN}
          />
        )}
        // Each month's result and the ended goals, on their own page (R-3, R-4).
        results={
          canDo('goal.update') ? (
            <PortalGoalResultsLinks propertyId={propertyId} programs={data.programs} />
          ) : null
        }
        footer={
          canDo('goal.create') ? (
            // The way to a goal for one Portal, each, a group or the average
            // (one click deeper, P-5), opened in place; drawn only when there is
            // something to add.
            <PortalGoalAddDoor
              propertyId={propertyId}
              focusTitle={focusPortalGoalCardTitle}
            />
          ) : null
        }
      />
    </PageShell>
  )
}
