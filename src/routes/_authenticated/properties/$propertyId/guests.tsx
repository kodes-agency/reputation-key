import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PropertyGuestVoicePage } from '#/components/features/property/property-guest-voice-page'
import { propertyQuery } from '#/routes/-queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { guestVoiceRangeSearch, type GuestVoiceRange } from '#/shared/dashboard-range'
import { guestVoiceRangeOfLocation, keptData } from './-dashboard-range-read'
import {
  guestVoiceGoalOf,
  guestVoiceReasonOf,
  guestVoiceV2PageOf,
  guestVoiceV2RangeOf,
  guestVoiceV2View,
} from './-guest-voice-v2'
import { ratingGoalCardQuery } from './goals/-rating-goal-queries'
import { guestVoiceDetailSearch } from './-guest-voice-search'
import { guestVoiceDetailTarget, guestVoiceDetailParams } from './-guest-voice-details'
import {
  propertyGuestVoiceV2Query,
  propertyGuestVoiceGoogleQuery,
} from './-guest-voice-queries'
import { GuestVoiceRouteDetails } from './-guest-voice-route-details'
import { useGuestVoiceDetailNavigation } from '#/components/features/property/guest-voice/use-guest-voice-detail-navigation'
import { RoutePending } from '#/components/layout/route-page-state'

export const propertyGuestsSearchSchema = z.object({
  range: guestVoiceRangeSearch,
  ...guestVoiceDetailSearch,
})

/**
 * Guest voice, read from the v3 analysis, the only analysis there is since the switch-on
 * (2026-10-30). The answer is the page, or says why there is none to draw yet: AI is off,
 * or nothing is analysed so far (the page says which).
 */
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
    // One read, and nothing after it: the answer is the page or the reason there is
    // none. (Until the switch-on it was a probe, and a Property without a v3 analysis
    // waited on it before today's page was read too; v3 is the only analysis now.) A read
    // that fails is the route's error, not a page that says the analysis is being prepared.
    await context.queryClient.ensureQueryData(
      (await import('./-guest-voice-queries')).propertyGuestVoiceV2Query(
        propertyId,
        guestVoiceRangeOfLocation(location),
      ),
    )
  },
  component: PropertyGuestsRoute,
})

function PropertyGuestsRoute() {
  const { propertyId } = Route.useParams()
  const search = Route.useSearch()
  const { range } = search
  const target = guestVoiceDetailTarget(search)
  const navigate = Route.useNavigate()
  const detailChange = (next: typeof target, options?: { replace: boolean }) => {
    void navigate({
      search: (previous) => ({ ...previous, ...guestVoiceDetailParams(next) }),
      replace: options?.replace,
    })
  }
  const navigation = useGuestVoiceDetailNavigation(target, detailChange)
  useEffect(() => {
    const normalized = guestVoiceDetailParams(target)
    if (
      Object.entries(normalized).some(
        ([key, value]) => search[key as keyof typeof normalized] !== value,
      )
    ) {
      void navigate({
        search: (previous) => ({ ...previous, ...normalized }),
        replace: true,
      })
    }
  }, [target, search, navigate])
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const reading = useQuery({
    ...propertyGuestVoiceV2Query(propertyId, range),
    placeholderData: keepPreviousData,
  })
  // A later range is read here, in the browser, after the loader's one read of the first
  // window. When that read fails nothing is left to draw and no reason to show, so the
  // failure is the route's error with its Try again (`keptData` throws it); without this
  // the page would sit on its loading frame for good.
  const answer = keptData(reading) ?? undefined
  const v2 = guestVoiceV2PageOf(answer)
  // 2.0 has no "All time": a bookmark that still says so is the automatic window, on the
  // page and in the address.
  const v2Range = guestVoiceV2RangeOf(range)
  useEffect(() => {
    if (v2 === null || range === v2Range) return
    void navigate({
      search: (previous) => ({ ...previous, range: v2Range }),
      replace: true,
    })
  }, [v2, range, v2Range, navigate])
  // The Google rating goal is named beside the top problem. A read that fails (no goal, no
  // permission, the capability off) leaves the page without the line, never in an error.
  const goalCard = useQuery({
    ...ratingGoalCardQuery(propertyId),
    retry: false,
    enabled: v2 !== null,
  })

  const google = useQuery({
    ...propertyGuestVoiceGoogleQuery(propertyId),
    enabled: v2 !== null,
  })

  const onRangeChange = (value: GuestVoiceRange) => {
    // A window on the page, not a place: replace, so arrowing through the
    // segments (a radio group chooses on focus) is no history entry per step.
    void navigate({
      search: (previous) => ({
        ...previous,
        range: value,
        ...guestVoiceDetailParams(null),
      }),
      replace: true,
    })
  }

  if (v2 !== null) {
    return (
      <GuestVoiceRouteDetails
        propertyId={propertyId}
        range={v2Range}
        read={v2}
        target={target}
        busy={reading.isPlaceholderData}
        navigation={navigation}
        refreshPage={reading.refetch}
      >
        {(drawer) => (
          <PropertyGuestVoicePage
            propertyId={propertyId}
            propertyName={propertyData.property.name}
            range={v2Range}
            onRangeChange={onRangeChange}
            v2={{
              ...guestVoiceV2View(v2, guestVoiceGoalOf(goalCard.data)),
              googleNumbers: google.data,
              drawer,
            }}
            busy={reading.isPlaceholderData}
          />
        )}
      </GuestVoiceRouteDetails>
    )
  }

  const reason = guestVoiceReasonOf(answer)
  // Entered at a range nothing has read yet (the loader is not re-run within its
  // fresh window): the page's own loading state, not an empty frame.
  if (reason === null) return <RoutePending />

  return (
    <PropertyGuestVoicePage
      propertyId={propertyId}
      propertyName={propertyData.property.name}
      range={range}
      onRangeChange={onRangeChange}
      state={reason}
    />
  )
}
