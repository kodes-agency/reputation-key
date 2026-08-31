// The body of the active detail tab.
//
// `PortalDetailTabs` mounts a panel for every tab so each trigger's
// aria-controls idref resolves, but only ever passes children to the active one
// — so this switch renders exactly what four sibling `{tab === '…' && …}` guards
// used to, with one decision instead of four nested ones.
//
// Each tab keeps its own component below: the route hands down one bag of
// resources for all four tabs, and mapping that bag onto four different
// component contracts in a single function is what made the old inline guards
// hard to read.

import { LinkTree } from '../link-tree/link-tree'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { PortalSettings } from '../portal-settings/portal-settings'
import { PortalShare } from '../portal-share/portal-share'
import type { RefObject } from 'react'
import type { IssuedPortalLink } from '../portal-share/portal-share-types'
import type { FormLike, PortalThemeDraft } from '../shared/types'
import type { PortalDetailTab } from './portal-detail-rules'
import type { PortalDetailResources } from './portal-detail-types'

/** The shell-owned draft state the Settings tab edits. */
type ThemeDraft = Readonly<{
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
  formRef: RefObject<FormLike | null>
}>

/** The once-shown public link, held by the shell so a tab switch cannot lose it. */
type LinkIssuance = Readonly<{
  issuedLink: IssuedPortalLink | null
  linksRevoked: boolean
  onLinkIssued: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}>

type Props = PortalDetailResources &
  ThemeDraft &
  LinkIssuance &
  Readonly<{ tab: PortalDetailTab }>

export function PortalDetailTabPanel(props: Props) {
  switch (props.tab) {
    case 'settings':
      return <SettingsPanel {...props} />
    case 'links':
      return <LinksPanel {...props} />
    case 'share':
      return <SharePanel {...props} />
    case 'analytics':
      return <AnalyticsPanel {...props} />
  }
}

type SettingsPanelProps = Pick<
  PortalDetailResources,
  | 'portal'
  | 'propertyId'
  | 'googleReviewDestination'
  | 'publicationHistory'
  | 'loadMorePublicationHistory'
  | 'updateMutation'
  | 'completeReviewMutation'
  | 'requestUploadUrl'
  | 'finalizeUpload'
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
  publicationHistory,
  loadMorePublicationHistory,
  updateMutation,
  completeReviewMutation,
  requestUploadUrl,
  finalizeUpload,
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
      publicationHistory={publicationHistory}
      loadMorePublicationHistory={loadMorePublicationHistory}
      mutation={updateMutation}
      completeReviewMutation={completeReviewMutation}
      theme={theme}
      onThemeChange={onThemeChange}
      requestUploadUrl={requestUploadUrl}
      finalizeUpload={finalizeUpload}
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
  LinkIssuance

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
