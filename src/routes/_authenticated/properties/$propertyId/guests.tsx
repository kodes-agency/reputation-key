import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PropertyGuestVoicePage } from '#/components/features/property/property-guest-voice-page'
import { getPropertyInsightsFn } from '#/contexts/ai/server/property-insights'
import { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { propertyQuery } from '#/routes/-queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { aiKeys } from '#/shared/queries/query-keys'
import {
  dashboardRangeSearch,
  toInsightsRange,
  type DashboardRange,
} from '#/shared/dashboard-range'
import { keptData, rangeOfLocation } from './-dashboard-range-read'
import { RoutePending } from '#/components/layout/route-page-state'

export const propertyGuestsSearchSchema = z.object({ range: dashboardRangeSearch })

export const propertyGuestsQuery = (propertyId: string, range: DashboardRange) =>
  queryOptions({
    queryKey: aiKeys.propertyInsights(propertyId, toInsightsRange(range)),
    queryFn: () =>
      getPropertyInsightsFn({ data: { propertyId, range: toInsightsRange(range) } }),
    staleTime: 60_000,
    // A capability denial is a permanent answer for this render, not a
    // transient fault: retrying would only delay the disabled state.
    retry: false,
  })

/**
 * How long the page waits for the headline sentence once its topics are in: it
 * is usually there by then, so nothing below it moves; a slower one follows on
 * its own (the page holds its line meanwhile) and never holds the page. The
 * page's own read (`PropertyGuestVoicePage`) shares this entry.
 */
const TREND_GRACE_MS = 300

const trendQuery = (propertyId: string) =>
  queryOptions({
    queryKey: aiKeys.propertyTrend(propertyId),
    queryFn: () => getPropertyAiTrendFn({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/guests')({
  staticData: { page: { title: 'Guest voice', tier: 'dashboard', under: 'property' } },
  validateSearch: propertyGuestsSearchSchema,
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'dashboard.read')) throw roleUnavailable('Guest voice', 'properties')
  },
  staleTime: 60_000,
  // The range is not a loader dependency (`-dashboard-range-read.ts`): the loader
  // primes the one the URL names when the page is entered, and the page reads the
  // rest through the cache, so choosing a range never swaps the page for its
  // skeleton.
  loader: async ({ params: { propertyId }, location, context }) => {
    const { queryClient } = context
    // The headline starts with the topics. A property with AI off has none, so
    // the read fails or says so; either way it is settled, never thrown.
    const trend = queryClient.prefetchQuery(trendQuery(propertyId))
    const result = await queryClient.ensureQueryData(
      propertyGuestsQuery(propertyId, rangeOfLocation(location)),
    )
    if (result.status === 'ready') {
      await Promise.race([
        trend,
        new Promise((resolve) => setTimeout(resolve, TREND_GRACE_MS)),
      ])
    }
  },
  component: PropertyGuestsRoute,
})

function PropertyGuestsRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const reading = useQuery({
    ...propertyGuestsQuery(propertyId, range),
    placeholderData: keepPreviousData,
  })
  const result = keptData(reading)

  const onRangeChange = (value: DashboardRange) => {
    // A window on the page, not a place: replace, so arrowing through the
    // segments (a radio group chooses on focus) is no history entry per step.
    void navigate({
      search: (previous) => ({ ...previous, range: value }),
      replace: true,
    })
  }

  // Entered at a range nothing has read yet (the loader is not re-run within its
  // fresh window): the page's own loading state, not an empty frame.
  if (result === null) return <RoutePending />

  return (
    <PropertyGuestVoicePage
      propertyId={propertyId}
      propertyName={propertyData.property.name}
      range={range}
      onRangeChange={onRangeChange}
      result={result}
      serverFns={{ getTrend: getPropertyAiTrendFn }}
      busy={reading.isPlaceholderData}
    />
  )
}
