// A goal's own page (ADR 0068, PLAN PG-21). A Property count goal is the
// Monthly portal goal, or one set beside it in a race: its page is the Monthly
// portal goal's (`/goals/portals`), where a notice about it lands too
// (`?result=` comes here). A goal for one Portal or one Portal Group has the
// Monthly portal goal's page made from its own subject ("Reception · portal
// goal"), with the same "Change number", "Count scans instead" (unless its
// subject already holds a goal for the other measure) and Stop; the average has
// the same page without a bar, with its own "Change number" and Stop; a goal
// for several subjects, made before goals had pages, a plain page with Stop.
// Behind `goal.use` with
// the other goal routes; the route asks the static table for `goal.read`
// alone, and the read itself asks for `goal.create`. Its read is primed by the
// loader from a module fetched on demand, so neither the read nor its server
// function joins first paint. A stop leaves for the Goals page.
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import type { PortalGoalSinglePageView } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { goalPersonNames } from '#/components/goals/goal-target-marker'
import type { PortalGoalCommands } from '#/components/goals/portal-goal-card-ready'
import { PortalGoalAveragePage } from '#/components/goals/portal-goal-average-page'
import {
  PortalGoalPage,
  focusPortalGoalPageTitle,
} from '#/components/goals/portal-goal-page'
import { PortalGoalSeveralPage } from '#/components/goals/portal-goal-several-page'
import type { PortalGoalSheetCommands } from '#/components/goals/portal-goal-sheet'
import {
  SINGLE_GOAL_WORDS,
  singleGoalTitle,
  singleSubjectWords,
  subjectPlace,
} from '#/components/goals/portal-goal-single-page-view'
import type { PortalGoalStopCommands } from '#/components/goals/portal-goal-stop-dialog'
import {
  markPortalGoalAddedStale,
  portalGoalCommands,
  portalGoalSinglePageQuery,
} from './-portal-goal-queries'
import { portalGoalDoorShown, usePortalGoalSheet } from './-portal-goal-sheet-host'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/goals/$goalId',
)({
  staticData: { page: { title: 'Goal', under: 'goals' } },
  beforeLoad: ({ context }) => {
    if (!can((context as AuthRouteContext).role, 'goal.read')) {
      throw roleUnavailable('Goal', 'properties')
    }
  },
  // `fetchQuery`, not `ensureQueryData`: a read that a change has marked stale is
  // read again before the page draws, never shown first.
  loader: async ({ params, context }) => {
    const queries = await import('./-portal-goal-queries')
    await context.queryClient.fetchQuery(
      queries.portalGoalSinglePageQuery(params.propertyId, params.goalId),
    )
  },
  component: GoalRoute,
})

type SubjectView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'subject' }>>
type AverageView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'average' }>>
type SeveralView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'several' }>>

/**
 * What a change or a stop marks stale: every Portal-goal read, and the month so
 * far of the goals of the goal's own subjects (a Portal Group page's goal card),
 * as an added goal does. A stop then leaves for the Goals page.
 */
function useGoalCommands(subjectKeys: readonly string[]) {
  const { propertyId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const markStale = () => markPortalGoalAddedStale(queryClient, propertyId, subjectKeys)
  const stop = {
    stopMonthlyPortalGoalFn: portalGoalCommands.stopMonthlyPortalGoal,
    onStopped: async () => {
      await markStale()
      await navigate({ to: '/properties/$propertyId/goals', params: { propertyId } })
    },
    onRefused: markStale,
  } satisfies PortalGoalStopCommands
  return { markStale, stop }
}

/**
 * What a goal's own page reads beside its goal: the Property, the page's read
 * (to read again after a refusal), and who made each change, by name, a side
 * read that never holds the page back.
 */
function useGoalPageReads() {
  const { propertyId, goalId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const pageRead = useSuspenseQuery(portalGoalSinglePageQuery(propertyId, goalId))
  const members = useQuery({
    ...membersQuery,
    enabled: canDo('member.list'),
    retry: false,
  })
  return {
    propertyId,
    goalId,
    canDo,
    propertyName: propData.property.name,
    pageRead,
    personName: goalPersonNames(members.data?.members),
  }
}

/** A goal for one Portal or one group: the Monthly portal goal's page, from its subject. */
function SubjectGoalPage({ view }: Readonly<{ view: SubjectView }>) {
  const { propertyId, goalId, canDo, propertyName, pageRead, personName } =
    useGoalPageReads()
  const { markStale, stop } = useGoalCommands([view.subject.key])
  const commands = {
    setMonthlyPortalGoalFn: portalGoalCommands.setMonthlyPortalGoal,
    changeMonthlyPortalGoalNowFn: portalGoalCommands.changeMonthlyPortalGoalNow,
    reviseMonthlyPortalGoalFn: portalGoalCommands.reviseMonthlyPortalGoal,
    onSet: markStale,
  } satisfies PortalGoalCommands & PortalGoalSheetCommands
  const { card } = view.page
  const sheet = usePortalGoalSheet({
    propertyId,
    card,
    commands,
    focusTitle: focusPortalGoalPageTitle,
    reread: async () => {
      const latest = (await pageRead.refetch()).data
      return latest?.kind === 'subject' ? latest.page.card : undefined
    },
    doorShown: portalGoalDoorShown(card, canDo('goal.update'), 'page'),
    changeTitle: SINGLE_GOAL_WORDS.changeTitle,
    canSwitch: !view.otherMeasureHeld,
  })
  return (
    <>
      <PortalGoalPage
        key={`${propertyId}:${goalId}`}
        propertyId={propertyId}
        propertyName={propertyName}
        page={view.page}
        canCreatePortal={canDo('portal.create')}
        canSeeResults={canDo('goal.update')}
        canChange={canDo('goal.update')}
        canStop={canDo('goal.cancel')}
        commands={{ ...commands, openSheet: sheet.open }}
        stop={stop}
        personName={personName}
        single={{
          title: singleGoalTitle(view.subject),
          name: singleSubjectWords(view.subject),
          where: subjectPlace(view.subject) ?? singleSubjectWords(view.subject),
          canSwitch: !view.otherMeasureHeld,
        }}
      />
      {sheet.sheet}
    </>
  )
}

/** The average: the same page without a bar, with its own "Change number" and Stop. */
function AverageGoalPage({ view }: Readonly<{ view: AverageView }>) {
  const { propertyId, goalId, canDo, propertyName, pageRead, personName } =
    useGoalPageReads()
  const { markStale, stop } = useGoalCommands([view.subject.key])
  return (
    <PortalGoalAveragePage
      key={`${propertyId}:${goalId}`}
      propertyId={propertyId}
      propertyName={propertyName}
      view={view}
      canChange={canDo('goal.update')}
      canStop={canDo('goal.cancel')}
      commands={{
        changeMonthlyPortalGoalNowFn: portalGoalCommands.changeMonthlyPortalGoalNow,
        reviseMonthlyPortalGoalFn: portalGoalCommands.reviseMonthlyPortalGoal,
        onChanged: markStale,
        reread: async () => {
          const latest = (await pageRead.refetch()).data
          return latest?.kind === 'average' ? latest.goal : undefined
        },
      }}
      stop={stop}
      personName={personName}
    />
  )
}

/** A goal for several subjects: a plain page, with Stop. */
function SeveralGoalPage({ view }: Readonly<{ view: SeveralView }>) {
  const { propertyId, goalId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { stop } = useGoalCommands(view.subjects.map(({ key }) => key))
  return (
    <PortalGoalSeveralPage
      key={`${propertyId}:${goalId}`}
      propertyId={propertyId}
      propertyName={propData.property.name}
      view={view}
      canStop={canDo('goal.cancel')}
      stop={stop}
    />
  )
}

function GoalRoute() {
  const { propertyId, goalId } = Route.useParams()
  const { data } = useSuspenseQuery(portalGoalSinglePageQuery(propertyId, goalId))
  if (data.kind === 'monthly') {
    return (
      <Navigate
        to="/properties/$propertyId/goals/portals"
        params={{ propertyId }}
        replace
      />
    )
  }
  switch (data.kind) {
    case 'subject':
      return <SubjectGoalPage view={data} />
    case 'average':
      return <AverageGoalPage view={data} />
    case 'several':
      return <SeveralGoalPage view={data} />
  }
}
