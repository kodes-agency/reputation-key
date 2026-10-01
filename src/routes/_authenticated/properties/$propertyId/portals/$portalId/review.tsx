// The workspace's review page: where a manager checks what guests will see
// before publishing. Publishing is a write, so it is gated like one; a viewer
// who cannot update the portal is sent back to the editor rather than shown a
// page whose only action the server would refuse.
import { createFileRoute, notFound, redirect, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { getPortalPreview } from '#/contexts/portal/server/portal-preview'
import { PortalReviewPage } from '#/components/features/portal/portal-review/portal-review-page'
import { describePublishOutcome } from '#/components/features/portal/portal-review/portal-review-footer'
import { resolveFixPeople } from '#/components/features/portal/portal-review/portal-review-checks'
import { membersQuery, propertyQuery } from '#/routes/-queries/route-queries'
import {
  portalQuery,
  portalReviewQuery,
  responsibleManagersQuery,
} from '../-portal-detail-data'
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
  // Fetched afresh on every entry: a review of stale facts is worse than none.
  loader: async ({ params, context }) => {
    await context.queryClient.fetchQuery({
      ...portalReviewQuery(params.portalId),
      staleTime: 0,
    })
  },
  component: PortalWorkspaceReview,
})

function PortalWorkspaceReview() {
  const { propertyId, portalId } = Route.useParams()
  const { tab, section } = Route.useSearch()
  const { user } = Route.useRouteContext()
  const navigate = useNavigate()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: review } = useSuspenseQuery(portalReviewQuery(portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: managers } = useSuspenseQuery(responsibleManagersQuery(portalId))
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const actions = usePortalDetailActions(propertyId, portalId)
  const { can: canDo } = usePermissions()
  const { portal } = portalData
  if (!portal) throw notFound()
  // The update that makes a portal live reports through the page, not through
  // its own "Portal updated" toast, so the silent one is used.
  const goLive = actions.autosaveUpdate
  const isPublishing = actions.publishChanges.isPending || goLive.isPending

  // A portal that is live replaces its live version; one that is not goes live.
  // Either way the answer is reported here, and the manager returns to editing.
  const publish = async () => {
    try {
      if (review.action === 'publish_changes') {
        const result = await actions.publishChanges({ data: { portalId } })
        toast.success(describePublishOutcome(result))
      } else {
        await goLive({ data: { portalId, publicationState: 'published' } })
        toast.success(describePublishOutcome(null))
      }
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId },
        search: { tab, section },
      })
    } catch (error) {
      toast.error(actionErrorMessage(error))
    }
  }

  return (
    <PortalReviewPage
      propertyId={propertyId}
      portal={portal}
      review={review}
      timeZone={propData.property.timezone}
      viewerId={user.id}
      fixPeople={resolveFixPeople(managers, membersData.members)}
      tab={tab}
      section={section}
      getPortalPreview={getPortalPreview}
      onPublish={() => void publish()}
      isPublishing={isPublishing}
      updateMutation={actions.update}
      canManage={canDo('portal.update')}
    />
  )
}
