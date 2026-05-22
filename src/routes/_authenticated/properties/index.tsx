// Property list — shows all properties for the active organization
// Reads from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { PropertyListPage } from '#/components/features/property/property-list-page'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/properties/')({
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const { properties } = authRoute.useLoaderData()
  return <PropertyListPage properties={properties} />
}
