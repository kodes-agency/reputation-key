// Portal list — shows all portals for a property
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { listPortals, deletePortal } from '#/contexts/portal/server/portals'
import { PortalListPage } from '#/components/features/portal/portal-list-page'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params }) => {
    const { portals } = await listPortals({
      data: { propertyId: params.propertyId },
    })
    return {
      portals,
      propertyId: params.propertyId,
    }
  },
  component: PortalListRoute,
})

function PortalListRoute() {
  const { propertyId } = Route.useParams()
  const { portals } = Route.useLoaderData()
  const { properties } = authRoute.useLoaderData()
  const propertySlug =
    properties?.find((p: { id: string; slug: string }) => p.id === propertyId)?.slug ?? ''
  return (
    <PortalListPage
      portals={portals}
      propertyId={propertyId}
      propertySlug={propertySlug}
      deletePortalFn={deletePortal}
    />
  )
}
