// The Monthly portal goal's page (ADR 0068): its month, what each Portal brought
// in, each month and what changed, one click from the card on the Goals page.
// Behind `goal.use` with the other goal routes (the Goals layout); the route
// asks the static table for `goal.read` alone, as the Google rating goal's page
// does, and the read itself asks for `goal.create`. Its read is primed by the
// loader from a module fetched on demand, so neither the read nor its server
// function joins first paint. Without a goal it shows the card's own state,
// with its doors to the set sheet (`-portal-goal-sheet-host.tsx`, as on the
// Goals page); the card draws no title here, so the page's title takes the
// focus back from the sheet. Under it all, "More portal goals": the other
// Portal goals, and "Add a portal goal" when it offers something (the M-rule,
// PLAN PG-20), whose sheet an address opens on a step (`?add=…`, where the old
// New goal page's links now lead, `-goal-new-redirect.ts`).
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import type { PortalGoalAddOptions } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import {
  openingOf,
  type PortalGoalAddAddress,
} from '#/components/goals/portal-goal-add-view'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import type { PortalGoalCommands } from '#/components/goals/portal-goal-card-ready'
import {
  PortalGoalPage,
  focusPortalGoalPageTitle,
} from '#/components/goals/portal-goal-page'
import { extrasSubjectName } from '#/components/goals/portal-goal-page-view'
import { PortalGoalExtras } from './-portal-goal-extras'
import { PortalGoalAddButton, usePortalGoalAdd } from './-portal-goal-add-host'
import { portalGoalPageSearchSchema } from './-portal-goal-page-search'
import {
  markPortalGoalReadsStale,
  portalGoalAddQuery,
  portalGoalCommands,
  portalGoalPageQuery,
} from './-portal-goal-queries'
import { usePortalGoalSheet } from './-portal-goal-sheet-host'
import { prefilledGoalSubjects } from './-goal-subject-prefill'

const TITLE = 'Monthly portal goal'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/portals',
)({
  staticData: { page: { title: TITLE, under: 'goals' } },
  validateSearch: portalGoalPageSearchSchema,
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
    await Promise.all([
      context.queryClient.fetchQuery(queries.portalGoalPageQuery(params.propertyId)),
      // "Add a portal goal" is drawn only when it offers something, and an
      // address may open it: its read comes with the page's.
      queries.prefetchPortalGoalAdd(context.queryClient, params.propertyId),
    ])
  },
  component: MonthlyPortalGoalRoute,
})

/**
 * The step an address asks the add sheet to open on, with the Portal or group
 * it names when it is one of this Property's that the sheet offers.
 */
function addressedOpening(
  options: PortalGoalAddOptions | undefined,
  search: PortalGoalAddAddress,
) {
  if (options === undefined) return null
  const [subject] = prefilledGoalSubjects(search.subject, {
    groupIds: options.groups.flatMap(({ subject: group }) =>
      group.kind === 'portal_group' ? [group.portalGroupId] : [],
    ),
    portalIds: options.onePortal.flatMap(({ subject: portal }) =>
      portal.kind === 'portal' ? [portal.portalId] : [],
    ),
  })
  return openingOf(options, {
    add: search.add,
    subject:
      subject === undefined || subject.kind === 'property'
        ? undefined
        : subject.kind === 'portal'
          ? `portal:${subject.portalId}`
          : `portal_group:${subject.portalGroupId}`,
  })
}

function MonthlyPortalGoalRoute() {
  const { propertyId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
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
  const set = {
    setMonthlyPortalGoalFn: portalGoalCommands.setMonthlyPortalGoal,
    onSet: () => markPortalGoalReadsStale(queryClient, propertyId),
  } satisfies PortalGoalCommands
  const sheet = usePortalGoalSheet(propertyId, page.card, set, focusPortalGoalPageTitle)
  const addRead = useQuery({
    ...portalGoalAddQuery(propertyId),
    enabled: canDo('goal.create'),
    retry: false,
  })
  const add = usePortalGoalAdd({
    propertyId,
    options: addRead.data,
    focusTitle: focusPortalGoalPageTitle,
    initial: addressedOpening(addRead.data, search),
    // Answered once: off the address, so a reload or Back does not open it again.
    onClosed: () =>
      void navigate({
        search: (prev) => ({ ...prev, add: undefined, subject: undefined }),
        replace: true,
      }),
  })
  const { name, timezone } = propData.property
  const { extras } = page
  return (
    <>
      <PortalGoalPage
        key={propertyId}
        propertyId={propertyId}
        propertyName={name}
        page={page}
        canCreatePortal={canDo('portal.create')}
        canSeeResults={canDo('goal.update')}
        commands={{ ...set, openSheet: sheet.open }}
        personName={goalPersonNames(members.data?.members)}
        extras={
          extras.goals.length === 0 ? null : (
            <PortalGoalExtras
              propertyId={propertyId}
              timezone={timezone}
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
              subjectName={(subject) =>
                extrasSubjectName(subject, name, extras.subjectNames)
              }
              now={now}
              titled={false}
            />
          )
        }
        addLink={
          // A goal for one Portal, each, a group or the average (one click
          // deeper, P-5), opened in place.
          add.offered ? (
            <PortalGoalAddButton
              onOpen={() => add.open({ step: 'choose', subject: null })}
            />
          ) : null
        }
      />
      {sheet.sheet}
      {add.sheet}
    </>
  )
}
