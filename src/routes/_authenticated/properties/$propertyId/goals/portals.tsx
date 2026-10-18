// The Monthly portal goal's page (ADR 0068): its month, what each Portal brought
// in, each month and what changed, one click from the card on the Goals page.
// Behind `goal.use` with the other goal routes (the Goals layout); the route
// asks the static table for `goal.read` alone, as the Google rating goal's page
// does, and the read itself asks for `goal.create`. Its read is primed by the
// loader from a module fetched on demand, so neither the read nor its server
// function joins first paint. Without a goal it shows the card's own state.
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { InlineLink } from '#/components/ui/inline-link'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import { PortalGoalPage } from '#/components/goals/portal-goal-page'
import { extrasSubjectName } from '#/components/goals/portal-goal-page-view'
import { PortalGoalExtras } from './-portal-goal-extras'
import {
  markPortalGoalReadsStale,
  portalGoalCommands,
  portalGoalPageQuery,
} from './-portal-goal-queries'

const TITLE = 'Monthly portal goal'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/portals',
)({
  staticData: { page: { title: TITLE, under: 'goals' } },
  // As the Google rating goal's page asks: of the built-in roles only the two
  // interactive manager roles hold `goal.read`, so the Member is answered here.
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw roleUnavailable(TITLE, 'properties')
    }
  },
  // `fetchQuery`, not `ensureQueryData`: a read that a set has marked stale is
  // read again before the page draws, never shown first.
  loader: async ({ params, context }) => {
    const queries = await import('./-portal-goal-queries')
    await context.queryClient.fetchQuery(queries.portalGoalPageQuery(params.propertyId))
  },
  component: MonthlyPortalGoalRoute,
})

function MonthlyPortalGoalRoute() {
  const { propertyId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const queryClient = useQueryClient()
  const [now] = useState(() => new Date())
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: page } = useSuspenseQuery(portalGoalPageQuery(propertyId))
  // Who made each change, by name. A side read that never holds the page back:
  // until it is read, a change is told without a person.
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  const { name, timezone } = propData.property
  const { extras } = page
  return (
    <PortalGoalPage
      key={propertyId}
      propertyId={propertyId}
      propertyName={name}
      page={page}
      canCreatePortal={canDo('portal.create')}
      canSeeResults={canDo('goal.update')}
      commands={{
        setMonthlyPortalGoalFn: portalGoalCommands.setMonthlyPortalGoal,
        onSet: () => markPortalGoalReadsStale(queryClient, propertyId),
      }}
      personName={goalPersonNames(members.data?.members)}
      extras={
        <PortalGoalExtras
          propertyId={propertyId}
          timezone={timezone}
          view="active"
          goals={extras.goals}
          monthlyGoalId={null}
          live={{
            byProgram: new Map(
              (extras.progress ?? []).map((goal) => [goal.programId, goal]),
            ),
            loading: false,
            // The read could not say their month so far: the rows say so.
            failed: extras.progress === null,
          }}
          subjectName={(subject) => extrasSubjectName(subject, name, extras.subjectNames)}
          now={now}
          titled={false}
        />
      }
      addLink={
        canDo('goal.create') ? (
          // A goal for one Portal, a group or an average (one click deeper,
          // P-5), on the New goal page until the add sheet replaces it.
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
  )
}
