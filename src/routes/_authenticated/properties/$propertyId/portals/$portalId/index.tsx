// The workspace's editor: one tab's content beneath the layout's header and tab
// strip. The tab and the Page tab's section come from the layout route's search
// (`?tab=`, `?section=`), which also maps the pre-workspace names; the layout
// owns the once-shown public link and the autosave coordinator.
import { createFileRoute, notFound } from '@tanstack/react-router'
import { getPortalHistory } from '#/contexts/portal/server/portals'
import {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from '#/contexts/portal/server/portal-versions'
import { getPortalAnalyticsFn } from '#/contexts/reporting/server/portal-analytics'
import { getPortalPreview } from '#/contexts/portal/server/portal-preview'
import { getPortalPrintKit } from '#/contexts/portal/server/portal-print-kit'
import { PortalDetailPage } from '#/components/features/portal/portal-detail/portal-detail-page'
import { usePortalDetailActions } from '../-portal-detail-actions'
import { usePortalDetailData } from '../-portal-detail-data'

/** The History tab's reads: server functions are handed to components, never imported by them. */
const HISTORY_READS = {
  getHistory: getPortalHistory,
  getVersions: getPortalVersions,
  getVersion: getPortalVersion,
  getVersionPreview: getPortalVersionPreview,
}

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId/',
)({
  component: PortalWorkspaceEditor,
})

function PortalWorkspaceEditor() {
  const { propertyId, portalId } = Route.useParams()
  const { tab, section } = Route.useSearch()
  const data = usePortalDetailData(propertyId, portalId)
  const { portal, tokenStatus } = data.portalData
  const { links } = data.linksData
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
      historyReads={HISTORY_READS}
      makeVersionLiveMutation={actions.makeVersionLive}
      propertyTimeZone={property.timezone}
      links={links}
      languageCoverage={data.languageCoverage}
      linktree={data.linktree}
      activeTab={tab}
      activeSection={section}
      updateMutation={actions.update}
      autosaveUpdateMutation={actions.autosaveUpdate}
      portalGroups={data.groupsData.groups}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      issueTokenMutation={actions.issueToken}
      rotateTokenMutation={actions.rotateToken}
      revokeTokenMutation={actions.revokeToken}
      revealAddressMutation={actions.revealAddress}
      getPortalPrintKit={getPortalPrintKit}
      downloadPrintKitMutation={actions.downloadPrintKit}
      getPortalAnalytics={getPortalAnalyticsFn}
      getPortalPreview={getPortalPreview}
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
