// Prop shapes for the portal detail shell.
//
// `PortalDetailResources` is the route-owned bag the tab panel forwards
// untouched. It lives here rather than in either component so the shell and the
// panel share one declaration instead of restating the resource props.

import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type {
  IssuedPortalLink,
  RotatePortalLinkInput,
} from '../portal-share/portal-share-types'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  PortalPublicationState,
  PortalThemeDraft,
  UpdatePortalVariables,
} from '../shared/types'
import type { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import type {
  PortalPublicationHistory,
  PortalTokenStatus,
} from '#/contexts/portal/application/public-api'
import type { PortalDetailTab } from './portal-detail-rules'
import type { GoogleReviewDestinationStatus } from '../portal-settings/google-review-destination-status'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
  PortalExperienceSettings,
} from '../portal-settings/portal-experience-settings-card'

export type PortalDetailPortal = Readonly<{
  id: string
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalThemeDraft
  privateFeedbackThreshold: number
  propertyId: string
  organizationId: string
  publicationState: PortalPublicationState
  primaryGuestLocale?: 'en' | 'bg'
  additionalGuestLocales?: readonly ('en' | 'bg')[]
}>

/** What the route owns and the four tab panels consume unchanged. */
export type PortalDetailResources = Readonly<{
  portal: PortalDetailPortal
  propertyId: string
  googleReviewDestination: GoogleReviewDestinationStatus
  publicationHistory: PortalPublicationHistory
  loadMorePublicationHistory?: Action<
    { data: { portalId: string; cursor?: number; limit?: number } },
    PortalPublicationHistory
  >
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
  updateMutation: Action<UpdatePortalVariables>
  completeReviewMutation: Action<CompleteReviewVariables, CompleteReviewResult>
  issueTokenMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  rotateTokenMutation: Action<{ data: RotatePortalLinkInput }, IssuedPortalLink>
  revokeTokenMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
  /** C2: whether a public link is live. The raw URL is never part of this. */
  tokenStatus: PortalTokenStatus
  getPortalAnalytics: typeof getPortalAnalyticsFn
  responsibleManagers?: PortalResponsibleManagerState
  responsibleManagerMembers?: readonly ResponsibleManagerMember[]
  updateResponsibleManagersMutation?: Action<{
    data: {
      portalId: string
      managerUserIds: string[]
      expectedRevision: number
    }
  }>
  portalExperience?: PortalExperienceSettings
  approvedDestinations?: PortalApprovedDestinationList
  portalExperienceActions?: PortalExperienceActions
}>

export type PortalResponsibleManagerState = Readonly<{
  assignments: readonly Readonly<{ userId: string }>[]
  eligibleManagers: readonly Readonly<{
    userId: string
    role: 'AccountAdmin' | 'PropertyManager'
  }>[]
  revision: number
  responsibilityNeeded: boolean
  responsibilityNeededSince: string | Date | null
}>

export type ResponsibleManagerMember = Readonly<{
  userId: string
  name: string
  email: string
  role: string | null
}>

export type PortalDetailPageProps = PortalDetailResources &
  Readonly<{
    organizationName: string
    activeTab: PortalDetailTab
    onTabChange: (tab: PortalDetailTab) => void
  }>
