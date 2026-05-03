import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { getPortal } from '#/contexts/portal/server/portals'
import {
  requestUploadUrl,
  finalizeUpload,
  updatePortal,
} from '#/contexts/portal/server/portals'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { PortalDetailPage } from '#/components/features/portal/PortalDetailPage'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { useServerFn } from '@tanstack/react-start'

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

  const requestUploadUrlFn = useServerFn(requestUploadUrl)
  const finalizeUploadFn = useServerFn(finalizeUpload)

  // Guest-facing portal URLs use the property slug (portals belong to properties)
  const authRoute = getRouteApi('/_authenticated')
  const { properties } = authRoute.useLoaderData()
  const propertySlug =
    properties?.find((p: { id: string }) => p.id === propertyId)?.slug ?? ''

  return (
    <PortalDetailPage
      portal={portal}
      propertyId={propertyId}
      categories={categories}
      links={links}
      updateMutation={mutation}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      propertySlug={propertySlug}
      requestUploadUrl={requestUploadUrlFn}
      finalizeUpload={finalizeUploadFn}
    />
  )
}
