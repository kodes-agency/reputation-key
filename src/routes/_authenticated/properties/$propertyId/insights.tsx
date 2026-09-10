import { useEffect, useRef } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PropertyInsightsReport } from '#/components/features/property/property-insights-report'
import { getPropertyInsightsFn } from '#/contexts/ai/server/property-insights'
import { propertyQuery } from '#/routes/-queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { aiKeys } from '#/shared/queries/query-keys'
import type { PropertyInsightsRangeDays } from '#/contexts/ai/application/public-api'

export const propertyInsightsSearchSchema = z.object({
  range: z.coerce
    .number()
    .pipe(z.union([z.literal(30), z.literal(90), z.literal(180)]))
    .catch(90)
    .default(90),
})

export const propertyInsightsQuery = (
  propertyId: string,
  rangeDays: PropertyInsightsRangeDays,
) =>
  queryOptions({
    queryKey: aiKeys.propertyInsights(propertyId, rangeDays),
    queryFn: () => getPropertyInsightsFn({ data: { propertyId, rangeDays } }),
    staleTime: 60_000,
    retry: false,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/insights')({
  validateSearch: propertyInsightsSearchSchema,
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'dashboard.read')) throw redirect({ to: '/dashboard' })
  },
  staleTime: 60_000,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ params: { propertyId }, deps: { range }, context }) => {
    await context.queryClient.ensureQueryData(propertyInsightsQuery(propertyId, range))
  },
  component: PropertyInsightsRoute,
})

function PropertyInsightsRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const wroteCanonicalRange = useRef(false)
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: result } = useSuspenseQuery(propertyInsightsQuery(propertyId, range))

  // Search defaults make the value typed; this one replace also materializes the
  // default in the address bar so an untouched 90-day view is still linkable.
  useEffect(() => {
    if (wroteCanonicalRange.current) return
    wroteCanonicalRange.current = true
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, range }),
    })
  }, [navigate, range])

  const onRangeChange = (rangeDays: PropertyInsightsRangeDays) => {
    void navigate({
      search: (previous) => ({ ...previous, range: rangeDays }),
    })
  }

  return (
    <PropertyInsightsReport
      propertyId={propertyId}
      propertyName={propertyData.property.name}
      rangeDays={range}
      onRangeChange={onRangeChange}
      result={result}
    />
  )
}
