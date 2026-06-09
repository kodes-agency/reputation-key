// Dashboard — smart redirect or property list
// Reads properties from parent layout loader instead of re-fetching.
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { DashboardPage } from '#/components/features/property/dashboard-page'
import { deleteProperty } from '#/contexts/property/server/properties'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardRoute,
})

function DashboardRoute() {
  const { properties } = authRoute.useLoaderData()
  const deleteAction = useMutationAction(deleteProperty, {
    invalidateRoutes: ['/_authenticated'],
  })
  return <DashboardPage properties={properties} deleteAction={deleteAction} />
}
