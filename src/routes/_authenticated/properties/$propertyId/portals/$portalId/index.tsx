// The workspace's editor: one tab's content beneath the layout's header and tab
// strip. The tab comes from the layout route's search (`?tab=`), which also
// maps the pre-workspace names; the layout owns the once-shown public link.
import { createFileRoute, notFound } from '@tanstack/react-router'
import { getPortalAnalyticsFn } from '#/contexts/reporting/server/portal-analytics'
import { PortalDetailPage } from '#/components/features/portal/portal-detail/portal-detail-page'
import { usePortalDetailActions } from '../-portal-detail-actions'
import { usePortalDetailData } from '../-portal-detail-data'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/',
)({
  component: PortalWorkspaceEditor,
})

function PortalWorkspaceEditor() {
  const { propertyId, portalId } = Route.useParams()
  const { tab } = Route.useSearch()
  const data = usePortalDetailData(propertyId, portalId)
  const { portal, tokenStatus } = data.portalData
  const { categories, links } = data.linksData
  const { property } = data.propData
  if (!portal) throw notFound()
  const ctx = Route.useRouteContext()
  const actions = usePortalDetailActions(propertyId, portalId)

  return (
    <PortalDetailPage
      key={portal.id}
      portal={portal}
      tokenStatus={tokenStatus}
      propertyId={propertyId}
      googleReviewDestination={{
        state: property.googleReviewDestination?.state ?? 'unavailable',
        retrievedAt: property.googleReviewDestination?.retrievedAt ?? null,
      }}
      publicationHistory={data.publicationHistory}
      loadMorePublicationHistory={data.loadMorePublicationHistory}
      categories={categories}
      links={links}
      activeTab={tab}
      updateMutation={actions.update}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      issueTokenMutation={actions.issueToken}
      rotateTokenMutation={actions.rotateToken}
      revokeTokenMutation={actions.revokeToken}
      getPortalAnalytics={getPortalAnalyticsFn}
      completeReviewMutation={actions.completeReview}
      responsibleManagers={data.responsibleManagers}
      responsibleManagerMembers={data.membersData.members}
      updateResponsibleManagersMutation={actions.updateResponsibleManagers}
      portalExperience={data.portalExperience}
      approvedDestinations={data.approvedDestinations}
      portalExperienceActions={actions.experience}
    />
  )
}
