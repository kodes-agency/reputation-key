// Properties — every property, side by side (docs/plan/property-list-table.md).
//
// Absorbs what `/dashboard` was for. The list itself comes from the parent
// layout's cached `propertiesQuery`; the comparison figures and setup progress
// are enrichments, each read with `useQuery` and started by the loader for at
// most its grace (`-properties-prefetch.ts`), so a denial or an outage costs a
// column, not the page. A manager whose fleet read is gated
// (`dashboard.fleet_read`) still gets the management list they came for.
//
// Search, filter and sort live in the URL (`propertyListSearchSchema`), and the
// default view writes nothing there, so `/properties` stays bare.
import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  PropertyListPage,
  type PropertyComparison,
  type PropertySetupProgress,
} from '#/components/features/property/property-list-page'
import { propertyListSearchSchema } from '#/components/features/property/property-list-search-schema'
import type { DataState } from '#/components/features/property/property-list-view'
import {
  propertiesQuery,
  propertySetupSummariesQuery,
} from '#/routes/-queries/route-queries'
import {
  LIFETIME,
  LIST_GRACE_MS,
  fleetQuery,
  prefetchPropertyList,
} from './-properties-prefetch'

export const Route = createFileRoute('/_authenticated/properties/')({
  staticData: { page: { title: 'Properties', tier: 'dashboard', loading: 'list' } },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // Properties admin list is a manager surface (property.admin).
    if (!can(role, 'property.admin')) {
      throw roleUnavailable('Properties', 'profile')
    }
  },
  validateSearch: (search) => propertyListSearchSchema.parse(search),
  // The figures and the setup progress are enrichments, so the page never waits
  // for them past the grace: they are usually in by then, which is what lets the
  // first paint be the finished list instead of rows that grow and re-sort.
  // Fresh for a minute, so typing a search (a search-only navigation) does not
  // run the loader again for every key.
  staleTime: 60_000,
  loader: async ({ context }) => {
    await Promise.race([
      prefetchPropertyList(context.queryClient),
      new Promise((resolve) => setTimeout(resolve, LIST_GRACE_MS)),
    ])
  },
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const fleet = useInfiniteQuery(fleetQuery(LIFETIME))
  const setupSummaries = useQuery(propertySetupSummariesQuery)

  // The fleet read pages by 50. Sorting by attention or rating is only honest
  // over every property, so read the rest before the order is applied.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = fleet
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const fleetState: DataState =
    fleet.isError || isFetchNextPageError
      ? 'unavailable'
      : fleet.isPending || hasNextPage
        ? 'loading'
        : 'ready'
  const setupState: DataState = setupSummaries.isError
    ? 'unavailable'
    : setupSummaries.isPending
      ? 'loading'
      : 'ready'

  const comparison = new Map<string, PropertyComparison>()
  for (const page of fleet.data?.pages ?? []) {
    for (const entry of page.entries) {
      const signals = entry.attentionSignals
      comparison.set(entry.propertyId, {
        timezone: entry.timezone,
        google: entry.google,
        ratingGoal: entry.ratingGoal,
        attention: {
          total: entry.totalAttention,
          overdue: signals.overdue,
          itemsToTriage: signals.itemsToTriage,
          escalated: signals.escalated,
          goalsBehindPace: signals.goalsBehindPace,
        },
      })
    }
  }

  const setup = setupSummaries.data
    ? new Map<string, PropertySetupProgress>(
        setupSummaries.data.map((entry) => [
          entry.propertyId,
          {
            completedCount: entry.completedCount,
            stepCount: entry.stepCount,
            nextStep: entry.nextStep,
          },
        ]),
      )
    : undefined

  return (
    <PropertyListPage
      properties={propsData.properties}
      comparison={comparison}
      fleet={fleetState}
      setup={setup}
      setupState={setupState}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  )
}
