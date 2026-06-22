// Property list — shows all properties for the active organization
// Reads from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { PropertyListPage } from '#/components/features/property/property-list-page'
import { deleteProperty } from '#/contexts/property/server/properties'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/properties/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // Properties admin list is a manager surface (property.admin).
    if (!can(role, 'property.admin')) throw redirect({ to: '/home' })
  },
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const { properties } = authRoute.useLoaderData()
  const deleteAction = useMutationAction(deleteProperty, {
    invalidateRoutes: ['/_authenticated'],
  })
  return <PropertyListPage properties={properties} deleteAction={deleteAction} />
}
