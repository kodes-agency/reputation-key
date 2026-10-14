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
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertyQuery, propertySetupQuery } from '#/routes/-queries/route-queries'
import { PropertySetupStrip } from '#/components/features/property/settings/property-setup-strip'
import { ratingGoalNotNowChosen } from '#/components/features/property/settings/property-setup-steps'
import { countBlockedPortals } from '#/components/features/portal/portal-overview/portal-attention'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { portalOverviewQuery } from './portals/-portal-overview-data'
import { OverviewRatingGoal } from './goals/-rating-goal-overview'
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
 * How long the Overview waits for the Google rating goal once its own reads are
 * in. The goal is read beside them and is usually there by then, so nothing
 * below it moves; a slower goal follows on its own, and never holds the page.
 */
const RATING_GOAL_GRACE_MS = 300

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  staticData: { page: { title: 'Overview', tier: 'dashboard', under: 'property' } },
  staleTime: 60_000,
  loader: async ({ params: { propertyId }, context }) => {
    const { role, capabilities } = context as AuthRouteContext
    // The Google rating goal, from a module fetched on demand so its reads
    // stay out of first paint; a failed read leaves the goal out, no more.
    const goal =
      can(role, 'goal.read') && capabilities.allowed.includes('goal.use')
        ? import('./goals/-rating-goal-queries')
            .then((queries) =>
              queries.prefetchRatingGoalOverview(context.queryClient, propertyId),
            )
            .catch(() => undefined)
        : null
    await Promise.all([
      context.queryClient.ensureQueryData(overviewQuery(propertyId, LIFETIME)),
      context.queryClient.ensureQueryData(overviewQuery(propertyId, PULSE)),
    ])
    // The goal's promise never rejects (its failure is caught above).
    if (goal !== null) {
      await Promise.race([
        goal,
        new Promise((resolve) => setTimeout(resolve, RATING_GOAL_GRACE_MS)),
      ])
    }
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
            timezone={propData.property.timezone}
            hasPortals={portals.any}
            notNowChosen={ratingGoalNotNowChosen(setup)}
          />
        ) : null
      }
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
 * How many portals guests cannot use, for the attention band, and whether there
 * are any, for the rating goal wizard's one next step. A side read, never a
 * reason to hold the page: a reader who may not read portals (or whose portal read is
 * off) is not asked, and a failed read leaves the chip out rather than the page in an
 * error. It is the Portals page's own read, so the two share one cache entry.
 */
function usePortalSummary(
  propertyId: string,
): Readonly<{ blocked: number; any: boolean }> {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const { data } = useQuery({
    ...portalOverviewQuery(propertyId),
    enabled: can('portal.read') && has('portal.read'),
    retry: false,
  })
  if (!data) return { blocked: 0, any: true }
  return { blocked: countBlockedPortals(data.portals), any: data.portals.length > 0 }
}

/** The Google rating goal is the viewer's to see: `goal.read`, with Goals on. */
function useGoalsShown(): boolean {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return can('goal.read') && has('goal.use')
}
