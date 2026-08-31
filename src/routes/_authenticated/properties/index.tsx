// Property list — shows all properties for the active organization
// Reads parent-layout data via the shared Query cache (propertiesQuery).
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { PropertyListPage } from '#/components/features/property/property-list-page'
import { propertiesQuery } from '#/routes/-queries/route-queries'

export const Route = createFileRoute('/_authenticated/properties/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // Properties admin list is a manager surface (property.admin).
    if (!can(role, 'property.admin')) throw redirect({ to: '/home' })
  },
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const properties = propsData.properties
  return <PropertyListPage properties={properties} />
}
