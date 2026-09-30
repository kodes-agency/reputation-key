// The body of the active workspace tab, for the tabs that are not the editor.
//
// The route mounts exactly one of these, so this switch is the single decision
// about what a tab shows. The Page tab is the section editor (portal-editor/),
// which lays itself out edge to edge, so it does not come through here.

import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { PortalPublicationHistoryCard } from '../portal-settings/portal-publication-history-card'
import { PortalShare } from '../portal-share/portal-share'
import type { PortalLinkIssuance } from '../portal-workspace/portal-link-issuance'
import type { PortalDetailTab } from './portal-detail-rules'
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
> &
  PortalLinkIssuance

function SharePanel({
  portal,
  tokenStatus,
  issueTokenMutation,
  rotateTokenMutation,
  revokeTokenMutation,
  issuedLink,
  linksRevoked,
  onLinkIssued,
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
      onLinksRevoked={onLinksRevoked}
      issueMutation={issueTokenMutation}
      rotateMutation={rotateTokenMutation}
      revokeMutation={revokeTokenMutation}
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
  publicationHistory,
  loadMorePublicationHistory,
}: Pick<
  PortalDetailResources,
  'portal' | 'publicationHistory' | 'loadMorePublicationHistory'
>) {
  return (
    <PortalPublicationHistoryCard
      history={publicationHistory}
      portalId={portal.id}
      loadMoreAction={loadMorePublicationHistory}
    />
  )
}
