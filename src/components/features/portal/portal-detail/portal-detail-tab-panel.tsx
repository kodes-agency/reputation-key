// The body of the active workspace tab, for the tabs that are not the editor.
//
// The route mounts exactly one of these, so this switch is the single decision
// about what a tab shows. The Page tab is the section editor (portal-editor/),
// which lays itself out edge to edge, so it does not come through here.

import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { PortalHistoryTab } from '../portal-history/portal-history-tab'
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
> &
  PortalLinkIssuance

function SharePanel({
  portal,
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
  getPortalAnalytics,
}: Pick<PortalDetailResources, 'portal' | 'propertyId' | 'getPortalAnalytics'>) {
  return (
    <PortalAnalyticsTab
      portalId={portal.id}
      propertyId={propertyId}
      getPortalAnalytics={getPortalAnalytics}
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
