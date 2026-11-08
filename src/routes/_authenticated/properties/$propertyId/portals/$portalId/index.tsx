import { PortalResultsScreen } from '#/contexts/reporting/portal-results/ui/portal-results-screen'
import { useQueries, useSuspenseQuery } from '@tanstack/react-query'
import { hasFailed } from '#/components/hooks/is-retrying'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PortalWorkspaceBodyFrame } from '#/components/features/portal/portal-workspace/portal-workspace-body-frame'
import { usePortalLinkIssuance } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import {
  SharePanel,
  HistoryPanel,
} from '#/components/features/portal/portal-detail/portal-detail-tab-panel'
import { PortalUnsavedChangesPrompt } from '#/components/features/portal/portal-detail/portal-unsaved-changes-prompt'
import { derivePortalDetailView } from '#/components/features/portal/portal-detail/portal-detail-rules'
import { PortalReadState } from '#/components/features/portal/portal-detail/portal-read-state'
import { portalResultsFns } from '../-portal-results-fns'
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
import {
  usePortalDetailData,
  portalQuery,
  portalShareQueries,
  portalHistoryQueries,
} from '../-portal-detail-data'
import { usePortalGoalLine } from '../-portal-goal-line'

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
  // Commands outlive individual tabs, including their pending state and refusals.
  const actions = usePortalDetailActions(propertyId, portalId)
  const { tab } = Route.useSearch()
  const { has } = useCapabilities()
  const view = derivePortalDetailView(tab, has('dashboard.use'))
  if (view.tab === 'page') return <PortalPageTab actions={actions} />
  return (
    <>
      <PortalUnsavedChangesPrompt />
      {view.tab === 'share' ? (
        <PortalShareTab actions={actions} />
      ) : view.tab === 'history' ? (
        <PortalHistoryTab actions={actions} />
      ) : (
        <PortalResultsTab />
      )}
    </>
  )
}

function useWorkspaceResources() {
  const { propertyId, portalId } = Route.useParams()
  const { data } = useSuspenseQuery(portalQuery(portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  if (!data.portal) throw notFound()
  return {
    propertyId,
    portalId,
    portal: data.portal,
    tokenStatus: data.tokenStatus,
    property: propData.property,
  }
}

type PortalTabActions = Readonly<{
  actions: ReturnType<typeof usePortalDetailActions>
}>

function PortalShareTab({ actions }: PortalTabActions) {
  const { portalId, portal, tokenStatus, property } = useWorkspaceResources()
  const issuance = usePortalLinkIssuance()
  const queries = useQueries({ queries: portalShareQueries(useTenantScope(), portalId) })
  const [managers, members] = queries
  if (
    queries.some((query) => query.data === undefined && hasFailed(query)) ||
    !managers.data ||
    !members.data
  ) {
    return <PortalReadState queries={queries} label="sharing details" />
  }
  return (
    <SharePanel
      portal={portal}
      tokenStatus={tokenStatus}
      propertyTimeZone={property.timezone}
      propertyCountryCode={property.countryCode ?? null}
      responsibleManagers={managers.data}
      responsibleManagerMembers={members.data.members}
      issueTokenMutation={actions.issueToken}
      rotateTokenMutation={actions.rotateToken}
      revokeTokenMutation={actions.revokeToken}
      revealAddressMutation={actions.revealAddress}
      getPortalPrintKit={getPortalPrintKit}
      downloadPrintFinalMutation={actions.downloadPrintFinal}
      savePrintWordingMutation={actions.savePrintWording}
      {...issuance}
    />
  )
}

function PortalHistoryTab({ actions }: PortalTabActions) {
  const { portalId, portal, property } = useWorkspaceResources()
  const queries = useQueries({ queries: portalHistoryQueries(portalId) })
  const history = queries[0].data
  if (queries.some((query) => query.data === undefined && hasFailed(query)) || !history) {
    return <PortalReadState queries={queries} label="publication history" />
  }
  return (
    <HistoryPanel
      portal={portal}
      propertyTimeZone={property.timezone}
      publicationHistory={history}
      historyReads={HISTORY_READS}
      makeVersionLiveMutation={actions.makeVersionLive}
    />
  )
}

function PortalResultsTab() {
  const { propertyId, portal, tokenStatus } = useWorkspaceResources()
  const goal = usePortalGoalLine({ propertyId, portal, onResults: true })
  return (
    <PortalWorkspaceBodyFrame wide>
      <PortalResultsScreen
        portal={portal}
        propertyId={propertyId}
        tokenStatus={tokenStatus}
        getPortalAnalytics={getPortalAnalyticsFn}
        goalLine={goal.line}
        goalLinePending={goal.pending}
      />
    </PortalWorkspaceBodyFrame>
  )
}

function PortalPageTab({ actions }: PortalTabActions) {
  const { propertyId, portalId } = Route.useParams()
  const { section } = Route.useSearch()
  const { data, queries } = usePortalDetailData(propertyId, portalId)
  const ctx = Route.useRouteContext()
  if (queries.some((query) => query.data === undefined && hasFailed(query)) || !data)
    return <PortalReadState queries={queries} label="page settings" />
  const { portal, tokenStatus } = data.portalData
  const { links } = data.linksData
  const { property } = data.propData
  if (!portal) throw notFound()

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
      propertyCountryCode={property.countryCode ?? null}
      links={links}
      languageCoverage={data.languageCoverage}
      linktree={data.linktree}
      activeTab="page"
      activeSection={section}
      autosaveUpdateMutation={actions.autosaveUpdate}
      changeLanguagesMutation={actions.changeLanguages}
      portalGroups={data.groupsData.groups}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      issueTokenMutation={actions.issueToken}
      rotateTokenMutation={actions.rotateToken}
      revokeTokenMutation={actions.revokeToken}
      revealAddressMutation={actions.revealAddress}
      getPortalPrintKit={getPortalPrintKit}
      downloadPrintFinalMutation={actions.downloadPrintFinal}
      savePrintWordingMutation={actions.savePrintWording}
      getPortalAnalytics={getPortalAnalyticsFn}
      getPortalLinkTaps={portalResultsFns.getLinkTaps}
      getPortalPreview={getPortalPreview}
      completeReviewMutation={actions.completeReview}
      responsibleManagers={data.responsibleManagers}
      responsibleManagerMembers={data.membersData.members}
      updateResponsibleManagersMutation={actions.updateResponsibleManagers}
      portalExperience={data.portalExperience}
      approvedDestinations={data.approvedDestinations}
      portalExperienceActions={actions.experience}
      portalLookActions={actions.look}
    />
  )
}
