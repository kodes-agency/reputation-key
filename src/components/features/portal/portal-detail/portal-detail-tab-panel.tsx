// The body of the active workspace tab, for the tabs that are not the editor.
//
// The route mounts exactly one of these, so this switch is the single decision
// about what a tab shows. The Page tab is the section editor (portal-editor/),
// which lays itself out edge to edge, so it does not come through here.

import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { PortalHistoryTab } from '../portal-history/portal-history-tab'
import { hasUncountedScans } from '../portal-overview/portal-attention'
import { resolveFixPeople } from '../portal-review/portal-review-checks'
import { PortalShare } from '../portal-share/portal-share'
import type { PortalLinkIssuance } from '../portal-workspace/portal-link-issuance'
import { countPendingChanges, type PortalDetailTab } from './portal-detail-rules'
import type { PortalDetailResources } from './portal-detail-types'

type Props = PortalDetailResources &
  PortalLinkIssuance &
  Readonly<{ tab: Exclude<PortalDetailTab, 'page'> }>

export function PortalDetailTabPanel(props: Props) {
  switch (props.tab) {
    case 'share':
      return <SharePanel {...props} />
    case 'results':
      return <AnalyticsPanel {...props} />
    case 'history':
      return <HistoryPanel {...props} />
  }
}

type SharePanelProps = Pick<
  PortalDetailResources,
  | 'portal'
  | 'tokenStatus'
  | 'issueTokenMutation'
  | 'rotateTokenMutation'
  | 'revokeTokenMutation'
  | 'revealAddressMutation'
  | 'getPortalPrintKit'
  | 'downloadPrintKitMutation'
  | 'propertyTimeZone'
  | 'responsibleManagers'
  | 'responsibleManagerMembers'
> &
  PortalLinkIssuance

function SharePanel({
  portal,
  propertyTimeZone,
  responsibleManagers,
  responsibleManagerMembers,
  tokenStatus,
  issueTokenMutation,
  rotateTokenMutation,
  revokeTokenMutation,
  revealAddressMutation,
  getPortalPrintKit,
  downloadPrintKitMutation,
  issuedLink,
  linksRevoked,
  onLinkIssued,
  onAddressRevealed,
  onLinksRevoked,
}: SharePanelProps) {
  return (
    <PortalShare
      portalId={portal.id}
      portalName={portal.name}
      propertyId={portal.propertyId}
      publicationState={portal.publicationState}
      timeZone={propertyTimeZone}
      managerNames={
        responsibleManagers && responsibleManagerMembers
          ? resolveFixPeople(responsibleManagers, responsibleManagerMembers).map(
              (person) => person.name,
            )
          : undefined
      }
      issuedLink={issuedLink}
      revoked={linksRevoked}
      tokenStatus={tokenStatus}
      onLinkIssued={onLinkIssued}
      onAddressRevealed={onAddressRevealed}
      onLinksRevoked={onLinksRevoked}
      issueMutation={issueTokenMutation}
      rotateMutation={rotateTokenMutation}
      revokeMutation={revokeTokenMutation}
      revealMutation={revealAddressMutation}
      printKit={
        getPortalPrintKit && downloadPrintKitMutation
          ? { read: getPortalPrintKit, downloadMutation: downloadPrintKitMutation }
          : undefined
      }
    />
  )
}

function AnalyticsPanel({
  portal,
  propertyId,
  tokenStatus,
  getPortalAnalytics,
  goalLine,
  goalLinePending,
}: Pick<
  PortalDetailResources,
  | 'portal'
  | 'propertyId'
  | 'tokenStatus'
  | 'getPortalAnalytics'
  | 'goalLine'
  | 'goalLinePending'
>) {
  return (
    <PortalAnalyticsTab
      portalId={portal.id}
      propertyId={propertyId}
      getPortalAnalytics={getPortalAnalytics}
      // A portal guests cannot open has nothing to count: its Results says to publish.
      pageIsLive={portal.publicationState === 'published'}
      // The same answer as the Portals overview's dash with "Not counted: older code".
      scansCounted={
        !hasUncountedScans({
          publicationState: portal.publicationState,
          token: tokenStatus,
        })
      }
      goalLine={goalLine}
      goalLinePending={goalLinePending}
    />
  )
}

function HistoryPanel({
  portal,
  propertyTimeZone,
  publicationHistory,
  historyReads,
  makeVersionLiveMutation,
}: Pick<
  PortalDetailResources,
  | 'portal'
  | 'propertyTimeZone'
  | 'publicationHistory'
  | 'historyReads'
  | 'makeVersionLiveMutation'
>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return (
    <PortalHistoryTab
      portalId={portal.id}
      portalName={portal.name}
      timeZone={propertyTimeZone}
      pendingChangeCount={countPendingChanges(publicationHistory)}
      mayMakeLive={can('portal.update') && has('portal.write')}
      pageIsLive={portal.publicationState === 'published'}
      reads={historyReads}
      makeLive={makeVersionLiveMutation}
    />
  )
}
