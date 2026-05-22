// Portal list — shows all portals for a property
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { listPortals } from '#/contexts/portal/server/portals'
import { PortalListPage } from '#/components/features/portal/portal-list-page'

const authRoute = getRouteApi('/_authenticated')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/portals/')({
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
  const propertySlug = properties?.find((p) => p.id === propertyId)?.slug ?? ''
  return <PortalListPage portals={portals} propertyId={propertyId} propertySlug={propertySlug} />
}
