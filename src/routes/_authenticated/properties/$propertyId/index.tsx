import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { getDashboardDataFn } from '#/contexts/dashboard/server/dashboard'
import { PropertyDashboard } from '#/components/features/property/property-dashboard'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  staleTime: 60_000,
  loader: async ({ params: { propertyId } }) => {
    const dashboard = await getDashboardDataFn({ data: { propertyId, timeRange: '30d' } })
    return { dashboard }
  },
  component: PropertyDashboardRoute,
})

function PropertyDashboardRoute() {
  const { property } = propertyRoute.useLoaderData()
  const { dashboard } = Route.useLoaderData()
  const { propertyId } = propertyRoute.useParams()
  return <PropertyDashboard property={property} dashboard={dashboard} propertyId={propertyId} />
}
