// Property overview tab — view and edit property details.
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { PropertyDetailFields } from '#/components/features/property/PropertyDetailFields'

const parentRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  component: PropertyOverview,
})

function PropertyOverview() {
  const { property } = parentRoute.useLoaderData()
  if (!property) return null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">{property.name}</p>
      </div>

      <PropertyDetailFields property={property} />
    </div>
  )
}
