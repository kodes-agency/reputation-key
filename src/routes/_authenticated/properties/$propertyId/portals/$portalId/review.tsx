// The workspace's review page: where a manager checks what guests will see
// before publishing. Publishing is a write, so it is gated like one; a viewer
// who cannot update the portal is told so, with a way back to the portal, rather
// than shown a page whose only action the server would refuse.
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { portalKeys } from '#/shared/queries/query-keys'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { getPortalPreview } from '#/contexts/portal/server/portal-preview'
import { PortalReviewPage } from '#/components/features/portal/portal-review/portal-review-page'
import { publishReview } from '#/components/features/portal/portal-review/portal-review-publish'
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
      // The portal itself opens on its Page tab, which a reader can see.
      throw roleUnavailable('Review and publish', {
        to: `/properties/${params.propertyId}/portals/${params.portalId}`,
        label: 'Back to Portal',
      })
    }
  },
  // Fetched afresh on every entry: a review of stale facts is worse than none.
  // A link preloaded on hover is not reused (`preloadStaleTime: 0`), or a click
  // within the router's 30 s preload window would skip this loader.
  preloadStaleTime: 0,
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
  const queryClient = useQueryClient()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: review } = useSuspenseQuery(portalReviewQuery(portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: managers } = useSuspenseQuery(responsibleManagersQuery(portalId))
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const actions = usePortalDetailActions(propertyId, portalId)
  const { portal } = portalData
  if (!portal) throw notFound()
  // The update that makes a portal live reports through the page, not through
  // its own "Portal updated" toast, so the silent one is used.
  const goLive = actions.autosaveUpdate
  const isPublishing = actions.publishChanges.isPending || goLive.isPending

  // The write and what it says live in publishReview; this only wires it up.
  const publish = () =>
    publishReview({
      review,
      portalId,
      publishChanges: actions.publishChanges,
      goLive,
      notify: toast,
      leave: () =>
        navigate({
          to: '/properties/$propertyId/portals/$portalId',
          params: { propertyId, portalId },
          search: { tab, section },
        }),
      refreshReview: () =>
        queryClient.invalidateQueries({ queryKey: portalKeys.review(portalId) }),
      errorMessage: actionErrorMessage,
    })

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
    />
  )
}
