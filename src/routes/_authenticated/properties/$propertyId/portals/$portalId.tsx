import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { getPortal } from '#/contexts/portal/server/portals'
import { getVisibleTargetBadges } from '#/contexts/badge/server/badges'
import {
  requestUploadUrl,
  finalizeUpload,
  updatePortal,
} from '#/contexts/portal/server/portals'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import { PortalDetailPage } from '#/components/features/portal'
import { PortalBadgeSection } from '#/components/features/badges/portal-badge-section'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useServerFn } from '@tanstack/react-start'
import { portalKeys, badgeKeys } from '#/shared/queries/query-keys'
import { propertyQuery, propertiesQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'
import { gateDarkRoute } from '#/shared/auth/dark-route-gate'

const portalQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.detail(portalId),
    queryFn: () => getPortal({ data: { portalId } }),
    staleTime: 30_000,
  })

const portalLinksQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.links(portalId),
    queryFn: () => listPortalLinks({ data: { portalId } }),
    staleTime: 30_000,
  })

const portalBadgesQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: badgeKeys.target({ propertyId, targetType: 'portal', targetId: portalId }),
    queryFn: () =>
      getVisibleTargetBadges({
        data: {
          propertyId,
          targetType: 'portal',
          targetId: portalId,
        },
      }),
    staleTime: 30_000,
  })

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  beforeLoad: async ({ context }) => {
    await gateDarkRoute('portal.read', 'Portals')
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    const [{ portal }, { categories, links }, badges] = await Promise.all([
      context.queryClient.ensureQueryData(portalQuery(params.portalId)),
      context.queryClient.ensureQueryData(portalLinksQuery(params.portalId)),
      context.queryClient.ensureQueryData(
        portalBadgesQuery(params.propertyId, params.portalId),
      ),
    ])
    if (!portal) throw notFound()
    return {
      portal,
      categories,
      links,
      propertyId: params.propertyId,
      badges: badges as BadgeAwardWithTarget[],
    }
  },
  component: PortalDetailRoute,
})

function PortalDetailRoute() {
  const { propertyId, portalId } = Route.useParams()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: linksData } = useSuspenseQuery(portalLinksQuery(portalId))
  const { data: badges } = useSuspenseQuery(portalBadgesQuery(propertyId, portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const { portal } = portalData
  const { categories, links } = linksData
  const { property } = propData
  const { properties } = propsData
  if (!portal) throw notFound()
  const ctx = Route.useRouteContext()

  const mutation = useActionMutation(updatePortal, {
    successMessage: 'Portal updated',
    invalidateKeys: [portalKeys.detail(portalId), portalKeys.links(portalId)],
  })

  const requestUploadUrlFn = useServerFn(requestUploadUrl)
  const finalizeUploadFn = useServerFn(finalizeUpload)

  const propertySlug = properties?.find((p) => p.id === propertyId)?.slug ?? ''

  return (
    <PageShell>
      <PageHeader
        title={portal.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name, to: `/properties/${propertyId}` },
          { label: 'Portals', to: `/properties/${propertyId}/portals` },
          { label: portal.name },
        ]}
      />
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
        getPortalAnalytics={getPortalAnalyticsFn}
      />
      <PortalBadgeSection badges={badges as BadgeAwardWithTarget[]} />
    </PageShell>
  )
}
