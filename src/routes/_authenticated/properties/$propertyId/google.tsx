import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import { PropertyGooglePage } from '#/components/features/property/property-google-page'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { dashboardRangeSearch, type DashboardRange } from '#/shared/dashboard-range'

// The Google report is leased and fetched by its own hook inside the section,
// not by this loader: it carries retry-after and lease-renewal semantics that a
// route loader cannot express, and a denial must degrade the section rather
// than the page (see `use-google-performance`).
export const Route = createFileRoute('/_authenticated/properties/$propertyId/google')({
  validateSearch: z.object({ range: dashboardRangeSearch }),
  component: PropertyGoogleRoute,
})

function PropertyGoogleRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))

  const onRangeChange = (value: DashboardRange) => {
    void navigate({ search: (previous) => ({ ...previous, range: value }) })
  }

  return (
    <PropertyGooglePage
      property={propData.property}
      propertyId={propertyId}
      range={range}
      onRangeChange={onRangeChange}
      performanceFns={{
        getPerformance: getPropertyGooglePerformance,
        renewLease: renewPropertyGooglePerformanceLease,
      }}
    />
  )
}
