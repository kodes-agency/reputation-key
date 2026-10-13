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
import { countBlockedPortals } from '#/components/features/portal/portal-overview/portal-attention'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { portalOverviewQuery } from './portals/-portal-overview-data'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'

/**
 * Overview has no range control and no `?range=` (redesign row 5): it reads two
 * fixed windows and shows each tile's identity beside its pulse. Two entries of
 * one read model, both cached 60 s and both primed by the loader — no new
 * contract, and the topic pages' own ranges stay separate cache entries.
 */
const LIFETIME: TimeRangePreset = 'all'
const PULSE: TimeRangePreset = '30d'

const overviewQuery = (propertyId: string, timeRange: TimeRangePreset) =>
  queryOptions({
    queryKey: dashboardKeys.property({ propertyId, timeRange }),
    queryFn: () => getPropertyOverviewFn({ data: { propertyId, timeRange } }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  staticData: { page: { title: 'Overview', tier: 'dashboard', under: 'property' } },
  staleTime: 60_000,
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(overviewQuery(propertyId, LIFETIME)),
      context.queryClient.ensureQueryData(overviewQuery(propertyId, PULSE)),
    ])
  },
  component: PropertyOverviewRoute,
})

function PropertyOverviewRoute() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: lifetime } = useSuspenseQuery(overviewQuery(propertyId, LIFETIME))
  const { data: pulse } = useSuspenseQuery(overviewQuery(propertyId, PULSE))
  const { data: setup } = useQuery(propertySetupQuery(propertyId))
  const blockedPortals = useBlockedPortals(propertyId)

  return (
    <PropertyOverview
      property={propData.property}
      propertyId={propertyId}
      lifetime={lifetime.dashboard}
      pulse={pulse.dashboard}
      // Attention is a standing count, not a windowed one — the all-time read
      // carries the same signals, so the pulse read's copy is redundant.
      signals={lifetime.signals}
      blockedPortals={blockedPortals}
      setupStrip={<PropertySetupStrip propertyId={propertyId} setup={setup} />}
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
 * How many portals guests cannot use, for the attention band. A side read, never a
 * reason to hold the page: a reader who may not read portals (or whose portal read is
 * off) is not asked, and a failed read leaves the chip out rather than the page in an
 * error. It is the Portals page's own read, so the two share one cache entry.
 */
function useBlockedPortals(propertyId: string): number {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const { data } = useQuery({
    ...portalOverviewQuery(propertyId),
    enabled: can('portal.read') && has('portal.read'),
    retry: false,
  })
  return data ? countBlockedPortals(data.portals) : 0
}
