import { createFileRoute } from '@tanstack/react-router'
import { getPortal } from '#/contexts/portal/server/portals'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { updatePortal } from '#/contexts/portal/server/portals'
import { PortalDetailPage } from '#/components/features/portal/PortalDetailPage'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  staleTime: 30_000,
  loader: async ({ params }) => {
    const [{ portal }, { categories, links }] = await Promise.all([
      getPortal({ data: { portalId: params.portalId } }),
      listPortalLinks({ data: { portalId: params.portalId } }),
    ])
    return {
      portal,
      categories: categories.map((c: { id: string; title: string; sortKey: string }) => ({
        id: c.id,
        title: c.title,
        sortKey: c.sortKey,
      })),
      links: links.map(
        (l: {
          id: string
          label: string
          url: string
          sortKey: string
          categoryId: string
        }) => ({
          id: l.id,
          label: l.label,
          url: l.url,
          sortKey: l.sortKey,
          categoryId: l.categoryId,
        }),
      ),
      propertyId: params.propertyId,
    }
  },
  component: PortalDetailRoute,
})

function PortalDetailRoute() {
  const { portal, categories, links, propertyId } = Route.useLoaderData()
  const ctx = Route.useRouteContext()

  const mutation = useMutationAction(updatePortal, {
    successMessage: 'Portal updated',
  })

  // Get property slug from parent layout's loaded properties
  const parentRoute = Route.useMatch({ from: '/_authenticated', strict: false })
  const propertySlug =
    parentRoute?.loaderData?.properties?.find((p: { id: string }) => p.id === propertyId)
      ?.slug ?? ''

  return (
    <PortalDetailPage
      portal={portal}
      propertyId={propertyId}
      categories={categories}
      links={links}
      updateMutation={mutation}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      propertySlug={propertySlug}
    />
  )
}
