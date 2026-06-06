import { createFileRoute, getRouteApi, notFound, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { getPortal } from '#/contexts/portal/server/portals'
import {
  requestUploadUrl,
  finalizeUpload,
  updatePortal,
} from '#/contexts/portal/server/portals'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { PortalDetailPage } from '#/components/features/portal'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { useServerFn } from '@tanstack/react-start'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params }) => {
    const [{ portal }, { categories, links }] = await Promise.all([
      getPortal({ data: { portalId: params.portalId } }),
      listPortalLinks({ data: { portalId: params.portalId } }),
    ])
    if (!portal) throw notFound()
    return {
      portal,
      categories,
      links,
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
    invalidateRoutes: ['/_authenticated/properties/$propertyId/portals/$portalId'],
  })

  // useServerFn for non-mutation server calls (upload URL generation/finalization)
  // These aren't form mutations — no auto-invalidation or toast needed
  const requestUploadUrlFn = useServerFn(requestUploadUrl)
  const finalizeUploadFn = useServerFn(finalizeUpload)

  // Guest-facing portal URLs use the property slug (portals belong to properties)
  const authRoute = getRouteApi('/_authenticated')
  const { properties } = authRoute.useLoaderData()
  const propertySlug =
    properties?.find((p: { id: string; slug: string }) => p.id === propertyId)?.slug ?? ''

  return (
    <PageShell>
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
    </PageShell>
  )
}
