// Prop shapes for the portal detail shell.
//
// `PortalDetailResources` is the route-owned bag the tab panel forwards
// untouched. It lives here rather than in either component so the shell and the
// panel share one declaration instead of re-stating thirteen identical props.

import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type { IssuedPortalLink } from '../portal-share/portal-share-types'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  PortalPublicationState,
  PortalThemeDraft,
  UpdatePortalVariables,
} from '../shared/types'
import type { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { PortalDetailTab } from './portal-detail-rules'

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
}>

/** What the route owns and the four tab panels consume unchanged. */
export type PortalDetailResources = Readonly<{
  portal: PortalDetailPortal
  propertyId: string
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
  updateMutation: Action<UpdatePortalVariables>
  completeReviewMutation: Action<CompleteReviewVariables, CompleteReviewResult>
  issueTokenMutation: Action<
    { data: { portalId: string; printBatch?: string } },
    IssuedPortalLink
  >
  rotateTokenMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  revokeTokenMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
  /** C2: whether a public link is live. The raw URL is never part of this. */
  tokenStatus: PortalTokenStatus
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeUpload: (input: {
    data: { portalId: string; key: string }
  }) => Promise<{ heroImageUrl: string }>
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
