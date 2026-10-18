// The Portal goal results page (ADR 0068 decision 14; PLAN PG-18): every
// month's result of the Property's Portal goals, the matrix that left the Goals
// page, and the Portal goals that have ended. Behind `goal.use` with the other
// goal routes (the Goals layout), for whoever may change a goal (`goal.update`),
// the gate the matrix had on the Goals page. Its reads are the Goals page's,
// primed by the loader from a module fetched on demand, so no query of its own
// joins first paint.
import { useState } from 'react'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
// From its own module, not the barrel: the barrel's modules would ride along.
import { buildGoalResultsMatrix } from '#/contexts/reporting/application/goal-results-matrix'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { goalAssignmentSubjectLabel } from '#/components/goals/goal-assignment-subject-label'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import { PortalGoalResults } from '#/components/goals/portal-goal-results'
import {
  endedPortalGoals,
  hasPortalGoalResults,
} from '#/components/goals/portal-goal-results-view'
import { portalGoalResultsQueries } from './-portal-goal-queries'

const TITLE = 'Portal goal results'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/portal-results',
)({
  staticData: { page: { title: TITLE, under: 'goals' } },
  // Of the built-in roles only the two interactive manager roles hold
  // `goal.update`, so the Member is answered here.
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.update')) {
      throw roleUnavailable(TITLE, 'properties')
    }
  },
  loader: async ({ params, context }) => {
    const queries = await import('./-portal-goal-queries')
    await queries.prefetchPortalGoalResults(context.queryClient, params.propertyId)
  },
  component: PortalGoalResultsRoute,
})

function PortalGoalResultsRoute() {
  const { propertyId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const [now] = useState(() => new Date())
  const queries = portalGoalResultsQueries(propertyId)
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data } = useSuspenseQuery(queries.goals)
  const { data: names } = useSuspenseQuery(queries.subjectNames)
  // Who changed a month's number, by name. A side read that never holds the
  // page back: until it is read, the change is told without one.
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  const { name } = propData.property
  const matrix = buildGoalResultsMatrix({
    programs: data.programs,
    property: { id: propertyId, name },
    portalGroups: names.groups,
    portals: names.portals,
  })
  const ended = endedPortalGoals(data.programs, {
    now,
    subjectName: (subject) =>
      goalAssignmentSubjectLabel(subject, name, names.groups, names.portals),
  })
  // Nothing to show yet: every way here appears only once there is, so this is
  // an address typed or kept from before. The Portal goals section says what
  // there is, and its title takes the focus.
  if (!hasPortalGoalResults({ matrix, ended })) {
    return (
      <Navigate
        to="/properties/$propertyId/goals"
        params={{ propertyId }}
        hash="portal-goals"
        state={{ focusPortalGoals: true }}
        replace
      />
    )
  }
  return (
    <PortalGoalResults
      propertyId={propertyId}
      propertyName={name}
      matrix={matrix}
      ended={ended}
      now={now}
      personName={goalPersonNames(members.data?.members)}
    />
  )
}
