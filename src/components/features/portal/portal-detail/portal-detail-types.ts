// Prop shapes for the portal detail shell.
//
// `PortalDetailResources` is the route-owned bag the tab panel forwards
// untouched. It lives here rather than in either component so the shell and the
// panel share one declaration instead of restating the resource props.

import type { Action } from '#/components/hooks/use-action'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { LinkTreeLink } from '../link-tree/link-tree-types'
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
import type { getPortalAnalyticsFn } from '#/contexts/reporting/server/portal-analytics'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import type {
  PortalLanguageCoverage,
  PortalLinktreeView,
  PortalPublicationHistory,
  PortalTokenStatus,
} from '#/contexts/portal/application/public-api'
import type { PortalDetailTab } from './portal-detail-rules'
import type {
  MakeVersionLiveAction,
  PortalHistoryReads,
} from '../portal-history/portal-history-tab'
import type { PortalShareMutations } from '../portal-share/portal-share-types'
import type {
  PortalPrintKitReader,
  PortalPrintKitResources,
} from '../portal-share/portal-print-kit-types'
import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import type { PortalGroupView } from '../portal-group/portal-group-types'
import type { GoogleReviewDestinationStatus } from '../portal-settings/google-review-destination-status'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
  PortalExperienceSettings,
} from '../portal-settings/portal-experience-settings-types'

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
  primaryGuestLocale?: GuestLocale
  additionalGuestLocales?: readonly GuestLocale[]
}>

/** What the route owns and the tab panels and the editor consume unchanged. */
export type PortalDetailResources = Readonly<{
  portal: PortalDetailPortal
  propertyId: string
  googleReviewDestination: GoogleReviewDestinationStatus
  publicationHistory: PortalPublicationHistory
  /** The History tab's three reads: the ledger, the versions, and one version. */
  historyReads: PortalHistoryReads
  /** "Make live again": the live activation moves to another version. */
  makeVersionLiveMutation: MakeVersionLiveAction
  /** The property's IANA zone, whose days History counts in. */
  propertyTimeZone: string
  links: readonly LinkTreeLink[]
  /** Which wording each language has. Absent: the Languages section shows no counts. */
  languageCoverage?: PortalLanguageCoverage
  /** The Linktree section: its switch and titles, and each tile with its texts. */
  linktree: PortalLinktreeView
  /** Explicit portal writes: the publication toggle and the language Save. Toasts on success. */
  updateMutation: Action<UpdatePortalVariables>
  /**
   * The same write for the autosaved sections. Silent on success: the header's
   * "Draft saved" is the acknowledgement, and a toast per keystroke pause is noise.
   */
  autosaveUpdateMutation: Action<UpdatePortalVariables>
  completeReviewMutation: Action<CompleteReviewVariables, CompleteReviewResult>
  issueTokenMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  rotateTokenMutation: Action<{ data: RotatePortalLinkInput }, IssuedPortalLink>
  revokeTokenMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
  /** "Download again": the live code's address, from its sealed copy. */
  revealAddressMutation: PortalShareMutations['revealMutation']
  /** The Share tab's print kit read. Absent (with its download): the tab offers no print kit. */
  getPortalPrintKit?: PortalPrintKitReader
  /** The Share tab's print kit download: makes the PDF on the server. */
  downloadPrintKitMutation?: PortalPrintKitResources['downloadMutation']
  /** C2: whether a public link is live. The raw URL is never part of this. */
  tokenStatus: PortalTokenStatus
  getPortalAnalytics: typeof getPortalAnalyticsFn
  /** The editor's live preview read: the draft, or the version guests can open now. */
  getPortalPreview: PortalPreviewReader
  responsibleManagers?: PortalResponsibleManagerState
  responsibleManagerMembers?: readonly ResponsibleManagerMember[]
  updateResponsibleManagersMutation?: Action<{
    data: {
      portalId: string
      managerUserIds: string[]
      expectedRevision: number
    }
  }>
  /** The property's groups, for the Group section. Absent: the section is not offered. */
  portalGroups?: readonly PortalGroupView[]
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
    /** The tab the URL asks for; the page applies the capability filter itself. */
    activeTab: PortalDetailTab
    /** The Page tab's section the URL asks for; the editor falls back when it is not offered. */
    activeSection?: PortalEditorSection
  }>
