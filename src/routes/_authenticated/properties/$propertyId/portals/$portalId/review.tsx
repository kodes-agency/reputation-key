// The workspace's review page: where a manager checks what guests will see
// before publishing. Publishing is a write, so it is gated like one; a viewer
// who cannot update the portal is sent back to the editor rather than shown a
// page whose only action the server would refuse.
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { PortalReviewPage } from '#/components/features/portal/portal-workspace/portal-review-page'
import { portalPublicationHistoryQuery, portalQuery } from '../-portal-detail-data'
import { usePortalDetailActions } from '../-portal-detail-actions'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/review',
)({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.write',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.update')) {
      throw redirect({
        to: '/properties/$propertyId/portals/$portalId',
        params,
        search: { tab: 'page' },
      })
    }
  },
  component: PortalWorkspaceReview,
})

function PortalWorkspaceReview() {
  const { propertyId, portalId } = Route.useParams()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: history } = useSuspenseQuery(portalPublicationHistoryQuery(portalId))
  const actions = usePortalDetailActions(propertyId, portalId)
  const { can: canDo } = usePermissions()
  const { portal } = portalData
  if (!portal) throw notFound()

  return (
    <PortalReviewPage
      portal={portal}
      publicationHistory={history}
      mutation={actions.update}
      canManage={canDo('portal.update')}
    />
  )
}
