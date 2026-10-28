import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { getPropertyOverviewFn } from '#/contexts/reporting/server/dashboard'
import {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import { PropertyOverview } from '#/components/features/property/property-overview'
import { dashboardKeys, goalKeys } from '#/shared/queries/query-keys'
import { primeWithinGrace } from '#/routes/-queries/prime-within-grace'
import { propertyQuery, propertySetupQuery } from '#/routes/-queries/route-queries'
import { PropertySetupStrip } from '#/components/features/property/settings/property-setup-strip'
import { ratingGoalNotNowChosen } from '#/components/features/property/settings/property-setup-steps'
import { countBlockedPortals } from '#/components/features/portal/portal-overview/portal-attention'
import {
  portalNextStepOf,
  type PortalNextStep,
} from '#/components/goals/rating-goal-portal-step'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { portalOverviewQuery } from './portals/-portal-overview-data'
import { OverviewRatingGoal } from './goals/-rating-goal-overview'
import { OverviewPortalGoal } from './goals/-portal-goal-overview'
import { useRatingGoalNotNow } from './goals/-rating-goal-not-now'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'

/**
 * Overview has no range control and no `?range=` (redesign row 5): it reads two
 * fixed windows and shows each tile's identity beside its pulse. Two entries of
 * one read model, both cached 60 s and both primed by the loader — no new
 * contract, and the topic pages' own ranges stay separate cache entries. Only
 * the all-time read carries Google's own numbers, which have no window.
 */
const LIFETIME: TimeRangePreset = 'all'
const PULSE: TimeRangePreset = '30d'

const overviewQuery = (propertyId: string, timeRange: TimeRangePreset) =>
  queryOptions({
    queryKey: dashboardKeys.property({ propertyId, timeRange }),
    queryFn: () => getPropertyOverviewFn({ data: { propertyId, timeRange } }),
    staleTime: 60_000,
  })

/**
 * How long the Overview waits for its side reads once its own reads are in: the
 * setup strip and the goals (the Google rating goal and the Monthly portal
 * goal), read together beside them, so it waits for the slowest, never longer.
 * They are usually there by then, so nothing below them moves; a slower one
 * never holds the page: in the browser it goes on in the background, and on the
 * server it is dropped (`primeWithinGrace`) and read again after hydration.
 */
const RATING_GOAL_GRACE_MS = 300

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  staticData: { page: { title: 'Overview', tier: 'dashboard', under: 'property' } },
  staleTime: 60_000,
  loader: async ({ params: { propertyId }, context }) => {
    const { role, capabilities } = context as AuthRouteContext
    // The Google rating goal and the Monthly portal goal, from one module
    // fetched on demand so their reads stay out of first paint (the Goals
    // page's, which re-exports `-overview-goals-prefetch`); a failed read
    // leaves its goal out, no more.
    const goal =
      can(role, 'goal.read') && capabilities.allowed.includes('goal.use')
        ? import('./goals/-goals-page-prefetch')
            .then((prefetch) =>
              prefetch.prefetchOverviewGoals(context.queryClient, propertyId, role),
            )
            .catch(() => undefined)
        : null
    // The setup strip and the goal prompt read this, and drew nothing until it
    // arrived, so the sections below them jumped down (a 170 px shift, the
    // page's whole cold layout shift). Read with the page, so the strip is in
    // the first paint. It is a side read: a failure (no retry, so it does not
    // hold the page) leaves the strip to its own read, never the page in an
    // error, and a slow one waits no longer than the goals do.
    const setupRead = propertySetupQuery(propertyId)
    const setup = context.queryClient.prefetchQuery({ ...setupRead, retry: false })
    await Promise.all([
      context.queryClient.ensureQueryData(overviewQuery(propertyId, LIFETIME)),
      context.queryClient.ensureQueryData(overviewQuery(propertyId, PULSE)),
    ])
    // Neither side read rejects (a failure is caught or settled above). The keys
    // name this loader's own side reads: the setup, and the two goals' families
    // (the module that starts them loads on demand). On the server whatever of
    // them is still pending when the grace ends is dropped, not streamed.
    await primeWithinGrace(
      context.queryClient,
      Promise.all([setup, goal]),
      [
        setupRead.queryKey,
        goalKeys.ratingGoal(propertyId),
        goalKeys.portalGoal(propertyId),
      ],
      RATING_GOAL_GRACE_MS,
    )
  },
  component: PropertyOverviewRoute,
})

function PropertyOverviewRoute() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: lifetime } = useSuspenseQuery(overviewQuery(propertyId, LIFETIME))
  const { data: pulse } = useSuspenseQuery(overviewQuery(propertyId, PULSE))
  const { data: setup } = useQuery(propertySetupQuery(propertyId))
  const portals = usePortalSummary(propertyId)
  const goals = useGoalsShown()
  const notNow = useRatingGoalNotNow(propertyId)

  return (
    <PropertyOverview
      property={propData.property}
      propertyId={propertyId}
      lifetime={lifetime.dashboard}
      pulse={pulse.dashboard}
      google={lifetime.google}
      // Attention is a standing count, not a windowed one — the all-time read
      // carries the same signals, so the pulse read's copy is redundant.
      signals={lifetime.signals}
      blockedPortals={portals.blocked}
      setupStrip={
        <PropertySetupStrip
          propertyId={propertyId}
          setup={setup}
          ratingGoalNotNow={notNow}
        />
      }
      ratingGoal={
        goals ? (
          <OverviewRatingGoal
            propertyId={propertyId}
            propertyName={propData.property.name}
            timezone={propData.property.timezone}
            portalNextStep={portals.nextStep}
            notNowChosen={ratingGoalNotNowChosen(setup)}
          />
        ) : null
      }
      portalGoal={goals ? <OverviewPortalGoal propertyId={propertyId} /> : null}
      guestVoiceFns={{
        getTrend: getPropertyAiTrendFn,
        getAggregates: getPropertyAiAggregatesFn,
      }}
      profileViewsFns={{
        getPerformance: getPropertyGooglePerformance,
        renewLease: renewPropertyGooglePerformanceLease,
      }}
    />
  )
}

/**
 * How many portals guests cannot use, for the attention band, and the rating
 * goal wizard's one next step: the monthly portal goal once one is live, else a
 * first Portal. A side read, never a reason to hold the page: a reader who may
 * not read portals (or whose portal read is off) is not asked, and a failed read
 * leaves the chip out rather than the page in an error; the step is then the
 * goal's card, which is never a dead end. It is the Portals page's own read, so
 * the two share one cache entry.
 */
function usePortalSummary(
  propertyId: string,
): Readonly<{ blocked: number; nextStep: PortalNextStep }> {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const { data } = useQuery({
    ...portalOverviewQuery(propertyId),
    enabled: can('portal.read') && has('portal.read'),
    retry: false,
  })
  if (!data) return { blocked: 0, nextStep: 'see' }
  return {
    blocked: countBlockedPortals(data.portals),
    nextStep: portalNextStepOf(data.portals),
  }
}

/**
 * The goals are the viewer's to see: `goal.read`, with Goals on. The Monthly
 * portal goal's slot asks `goal.create` of its own.
 */
function useGoalsShown(): boolean {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return can('goal.read') && has('goal.use')
}
