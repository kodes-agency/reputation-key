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
import { getGuestVoiceV2Fn } from '#/contexts/ai/server/guest-voice-v2'
import { getPropertyInsightsFn } from '#/contexts/ai/server/property-insights'
import { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { primeWithinGrace } from '#/routes/-queries/prime-within-grace'
import { propertyQuery } from '#/routes/-queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { aiKeys } from '#/shared/queries/query-keys'
import { guestVoiceRangeSearch, type GuestVoiceRange } from '#/shared/dashboard-range'
import { guestVoiceRangeOfLocation, keptData } from './-dashboard-range-read'
import { guestVoiceGoalOf, guestVoiceV2PageOf, guestVoiceV2View } from './-guest-voice-v2'
import { ratingGoalCardQuery } from './goals/-rating-goal-queries'
import { RoutePending } from '#/components/layout/route-page-state'

export const propertyGuestsSearchSchema = z.object({ range: guestVoiceRangeSearch })

export const propertyGuestsQuery = (propertyId: string, range: GuestVoiceRange) =>
  queryOptions({
    queryKey: aiKeys.propertyInsights(propertyId, range),
    queryFn: () => getPropertyInsightsFn({ data: { propertyId, range } }),
    staleTime: 60_000,
    // A capability denial is a permanent answer for this render, not a
    // transient fault: retrying would only delay the disabled state.
    retry: false,
  })

/**
 * Guest voice 2.0, which a Property whose reviews have a v3 analysis is drawn as. The
 * answer says so, or says why today's page is the one to draw.
 */
export const propertyGuestVoiceV2Query = (propertyId: string, range: GuestVoiceRange) =>
  queryOptions({
    queryKey: aiKeys.guestVoiceV2(propertyId, range),
    queryFn: () => getGuestVoiceV2Fn({ data: { propertyId, range } }),
    staleTime: 60_000,
    retry: false,
  })

/**
 * How long the page waits for the headline sentence once its topics are in: it
 * is usually there by then, so nothing below it moves; a slower one never holds
 * the page (the page holds its line meanwhile). In the browser it follows on its
 * own; on the server it is dropped (`primeWithinGrace`) and read again after
 * hydration. The page's own read (`PropertyGuestVoicePage`) shares this entry.
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
    const range = guestVoiceRangeOfLocation(location)
    // A Property whose reviews have a v3 analysis is drawn as Guest voice 2.0 and needs
    // nothing of today's page. Any other answer (no v3 analysis, AI off, not ready, or a
    // read that failed) leaves today's page to be primed as it always was.
    const v2 = await queryClient
      .ensureQueryData(propertyGuestVoiceV2Query(propertyId, range))
      .catch(() => undefined)
    if (guestVoiceV2PageOf(v2) !== null) return
    // The headline starts with the topics. A property with AI off has none, so
    // the read fails or says so; either way it is settled, never thrown.
    const trend = queryClient.prefetchQuery(trendQuery(propertyId))
    const result = await queryClient.ensureQueryData(
      propertyGuestsQuery(propertyId, range),
    )
    if (result.status === 'ready') {
      await primeWithinGrace(
        queryClient,
        trend,
        [aiKeys.propertyTrend(propertyId)],
        TREND_GRACE_MS,
      )
    }
  },
  component: PropertyGuestsRoute,
})

function PropertyGuestsRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const v2Reading = useQuery({
    ...propertyGuestVoiceV2Query(propertyId, range),
    placeholderData: keepPreviousData,
  })
  const v2 = guestVoiceV2PageOf(v2Reading.data)
  // The Google rating goal is named beside the top problem. A read that fails (no goal, no
  // permission, the capability off) leaves the page without the line, never in an error.
  const goalCard = useQuery({
    ...ratingGoalCardQuery(propertyId),
    retry: false,
    enabled: v2 !== null,
  })
  // Today's page is read only where 2.0 is not drawn. A failed 2.0 read is today's page,
  // not an error page: 2.0 is the newer of the two.
  const reading = useQuery({
    ...propertyGuestsQuery(propertyId, range),
    placeholderData: keepPreviousData,
    enabled: v2 === null && !v2Reading.isPending,
  })
  const result = v2 === null ? keptData(reading) : null

  const onRangeChange = (value: GuestVoiceRange) => {
    // A window on the page, not a place: replace, so arrowing through the
    // segments (a radio group chooses on focus) is no history entry per step.
    void navigate({
      search: (previous) => ({ ...previous, range: value }),
      replace: true,
    })
  }

  if (v2 !== null) {
    return (
      <PropertyGuestVoicePage
        propertyId={propertyId}
        propertyName={propertyData.property.name}
        range={range}
        onRangeChange={onRangeChange}
        v2={guestVoiceV2View(v2, guestVoiceGoalOf(goalCard.data))}
        busy={v2Reading.isPlaceholderData}
      />
    )
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
