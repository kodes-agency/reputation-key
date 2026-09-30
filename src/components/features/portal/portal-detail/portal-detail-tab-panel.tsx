// The body of the active workspace tab.
//
// The route mounts exactly one of these, so this switch is the single decision
// about what a tab shows. The route hands down one bag of resources for all
// four tabs, and each tab below maps its slice of that bag onto its own
// component's contract; doing it for all of them in one function is what made
// the old inline guards hard to read.
//
// The Page tab is the old Settings and Links tabs, stacked, until the section
// list (slice 27) splits them into sections.

import { LinkTree } from '../link-tree/link-tree'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { PortalPublicationHistoryCard } from '../portal-settings/portal-publication-history-card'
import { PortalSettings } from '../portal-settings/portal-settings'
import { PortalShare } from '../portal-share/portal-share'
import type { RefObject } from 'react'
import type { PortalLinkIssuance } from '../portal-workspace/portal-link-issuance'
import type { FormLike, PortalThemeDraft } from '../shared/types'
import type { PortalDetailTab } from './portal-detail-rules'
import type { PortalDetailResources } from './portal-detail-types'

/** The shell-owned draft state the Settings section edits. */
type ThemeDraft = Readonly<{
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
  formRef: RefObject<FormLike | null>
}>

type Props = PortalDetailResources &
  ThemeDraft &
  PortalLinkIssuance &
  Readonly<{ tab: PortalDetailTab }>

export function PortalDetailTabPanel(props: Props) {
  switch (props.tab) {
    case 'page':
      return (
        <div className="space-y-6">
          <SettingsPanel {...props} />
          <LinksPanel {...props} />
        </div>
      )
    case 'share':
      return <SharePanel {...props} />
    case 'results':
      return <AnalyticsPanel {...props} />
    case 'history':
      return <HistoryPanel {...props} />
  }
}

type SettingsPanelProps = Pick<
  PortalDetailResources,
  | 'portal'
  | 'propertyId'
  | 'googleReviewDestination'
  | 'updateMutation'
  | 'completeReviewMutation'
  | 'responsibleManagers'
  | 'responsibleManagerMembers'
  | 'updateResponsibleManagersMutation'
  | 'portalExperience'
  | 'approvedDestinations'
  | 'portalExperienceActions'
> &
  ThemeDraft

function SettingsPanel({
  portal,
  propertyId,
  googleReviewDestination,
  updateMutation,
  completeReviewMutation,
  theme,
  onThemeChange,
  formRef,
  responsibleManagers,
  responsibleManagerMembers,
  updateResponsibleManagersMutation,
  portalExperience,
  approvedDestinations,
  portalExperienceActions,
}: SettingsPanelProps) {
  return (
    <PortalSettings
      portal={portal}
      propertyId={propertyId}
      googleReviewDestination={googleReviewDestination}
      mutation={updateMutation}
      completeReviewMutation={completeReviewMutation}
      theme={theme}
      onThemeChange={onThemeChange}
      formRef={formRef}
      responsibleManagers={responsibleManagers}
      responsibleManagerMembers={responsibleManagerMembers}
      updateResponsibleManagersMutation={updateResponsibleManagersMutation}
      portalExperience={portalExperience}
      approvedDestinations={approvedDestinations}
      portalExperienceActions={portalExperienceActions}
    />
  )
}

function LinksPanel({
  portal,
  categories,
  links,
}: Pick<PortalDetailResources, 'portal' | 'categories' | 'links'>) {
  return <LinkTree portalId={portal.id} categories={categories} links={links} />
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
