import { useQueries, useSuspenseQuery } from '@tanstack/react-query'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { usePortalLinkIssuance } from '#/components/features/portal/portal-workspace/portal-link-issuance'
import { PortalShareSection } from '#/contexts/portal/workspace/ui/portal-share-section'
import { PortalHistorySection } from '#/contexts/portal/workspace/ui/portal-history-section'
import { PortalResultsScreen } from '#/contexts/reporting/portal-results/ui/portal-results-screen'
import { PortalWorkspaceBodyFrame } from '#/components/features/portal/portal-workspace/portal-workspace-body-frame'
import { PortalUnsavedChangesPrompt } from '#/contexts/portal/workspace/ui/portal-unsaved-changes-prompt'
import { derivePortalDetailView } from '#/contexts/portal/workspace/ui/portal-detail-rules'
import { portalResultsFns } from '../-portal-results-fns'
// The workspace's editor: one tab's content beneath the layout's header and tab
// strip. The tab and the Page tab's section come from the layout route's search
// (`?tab=`, `?section=`), which also maps the pre-workspace names; the layout
// owns the once-shown public link and the autosave coordinator.
import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  getPortalHistory,
  getPortalPublicationHistory,
} from '#/contexts/portal/server/portals'
import {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from '#/contexts/portal/server/portal-versions'
import { getPortalAnalyticsFn } from '#/contexts/reporting/server/portal-analytics'
import { getPortalPreview } from '#/contexts/portal/server/portal-preview'
import { getPortalPrintKit } from '#/contexts/portal/server/portal-print-kit'
import { PortalEditor } from '#/contexts/portal/editor/ui/portal-editor'
import { usePortalDetailActions } from '../-portal-detail-actions'
import {
  usePortalPageReads,
  portalQuery,
  portalShareQueries,
} from '../-portal-detail-data'
import { usePortalGoalLine } from '../-portal-goal-line'

/** The History tab's reads: server functions are handed to components, never imported by them. */
const HISTORY_READS = {
  getHistory: getPortalHistory,
  getVersions: getPortalVersions,
  getPublicationHistory: getPortalPublicationHistory,
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
  return (
    <>
      <PortalUnsavedChangesPrompt />
      {view.tab === 'page' ? (
        <PortalPageTab actions={actions} />
      ) : view.tab === 'share' ? (
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
  const [managers, members] = useQueries({
    queries: portalShareQueries(useTenantScope(), portalId),
  })
  return (
    <PortalShareSection
      portal={portal}
      tokenStatus={tokenStatus}
      property={{
        timeZone: property.timezone,
        countryCode: property.countryCode ?? null,
      }}
      reads={{ managers, members }}
      commands={{
        issueToken: actions.issueToken,
        rotateToken: actions.rotateToken,
        revokeToken: actions.revokeToken,
        revealAddress: actions.revealAddress,
        printKit: {
          read: getPortalPrintKit,
          downloadPrint: actions.downloadPrint,
          saveWording: actions.savePrintWording,
        },
      }}
      issuance={issuance}
    />
  )
}

function PortalHistoryTab({ actions }: PortalTabActions) {
  const { portal, property } = useWorkspaceResources()
  return (
    <PortalHistorySection
      portal={portal}
      timeZone={property.timezone}
      reads={HISTORY_READS}
      makeLive={actions.makeVersionLive}
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
  const { propertyId, portal, property } = useWorkspaceResources()
  const { section } = Route.useSearch()
  const pageReads = usePortalPageReads(propertyId, portal.id)
  return (
    <PortalEditor
      key={portal.id}
      requestedSection={section}
      resources={{
        ...pageReads,
        portal,
        propertyId,
        googleReviewDestination: {
          state: property.googleReviewDestination?.state ?? 'unavailable',
          retrievedAt: property.googleReviewDestination?.retrievedAt ?? null,
        },
        autosaveUpdateMutation: actions.autosaveUpdate,
        changeLanguagesMutation: actions.changeLanguages,
        completeReviewMutation: actions.completeReview,
        getPortalLinkTaps: portalResultsFns.getLinkTaps,
        getPortalPreview,
        updateResponsibleManagersMutation: actions.updateResponsibleManagers,
        portalExperienceActions: actions.experience,
        portalLookActions: actions.look,
      }}
    />
  )
}
