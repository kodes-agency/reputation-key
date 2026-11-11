// Prop shapes shared by the editor and its sections.

import type { UseQueryResult } from '@tanstack/react-query'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeLink } from '#/contexts/portal/editor/ui/link-tree/link-tree-types'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  ChangePortalLanguagesVariables,
  UpdatePortalVariables,
} from '#/components/features/portal/shared/types'
import type { PortalLinkTapsRead } from '../contracts'
import type { PortalPreviewReader } from '#/components/features/portal/portal-preview/portal-preview-pane'
import type {
  PortalLanguageCoverage,
  PortalLinktreeView,
  PortalPublicationHistory,
} from '#/contexts/portal/application/portal-management-contracts'
import type { PortalLookActions } from '#/contexts/portal/look/ui/portal-look-types'
import type { PortalGroupView } from '#/components/features/portal/portal-group/portal-group-types'
import type { GoogleReviewDestinationStatus } from '#/components/features/portal/portal-settings/google-review-destination-status'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
  PortalExperienceSettings,
} from '#/components/features/portal/portal-settings/portal-experience-settings-types'
import type {
  PortalDetailPortal,
  PortalResponsibleManagerState,
  ResponsibleManagerMember,
} from '#/contexts/portal/workspace/ui/portal-detail-types'

/** One ancillary read a section waits on: its answer, or why it has none yet. */
export type PortalEditorRead = Pick<
  UseQueryResult,
  'isError' | 'isFetching' | 'errorUpdateCount' | 'data' | 'refetch'
>

/** The ancillary reads, each named by the resource it fills. */
export type PortalEditorReadKey =
  | 'languageCoverage'
  | 'linktree'
  | 'portalGroups'
  | 'responsibleManagers'
  | 'responsibleManagerMembers'
  | 'publicationHistory'
  | 'portalExperience'
  | 'approvedDestinations'

/**
 * What the editor shows, as the route loaded it. The portal and its property
 * come first; every other read arrives on its own, so a section whose read is
 * still loading or failed says so itself while the others stay usable. Without
 * `reads` (a story, or a caller that already holds the data) a resource that is
 * present is simply there.
 */
export type PortalEditorResources = Readonly<{
  portal: PortalDetailPortal
  propertyId: string
  googleReviewDestination: GoogleReviewDestinationStatus
  /** The live version the link check names. */
  publicationHistory?: PortalPublicationHistory
  /** The Linktree line's count; the section itself reads `linktree`. */
  links?: readonly LinkTreeLink[]
  /** Which wording each language has. */
  languageCoverage?: PortalLanguageCoverage
  /** The Linktree section: its switch and titles, and each tile with its texts. */
  linktree?: PortalLinktreeView
  /**
   * The portal patch, for every section that saves one. Silent on success: the
   * header's "Draft saved" is the acknowledgement, and a toast per keystroke
   * pause is noise.
   */
  autosaveUpdateMutation: Action<UpdatePortalVariables>
  /** The Languages section's save: the same silent acknowledgement. */
  changeLanguagesMutation: Action<ChangePortalLanguagesVariables>
  completeReviewMutation: Action<CompleteReviewVariables, CompleteReviewResult>
  getPortalLinkTaps?: PortalLinkTapsRead
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
  /** The property's groups, for the Group section. */
  portalGroups?: readonly PortalGroupView[]
  portalExperience?: PortalExperienceSettings
  approvedDestinations?: PortalApprovedDestinationList
  portalExperienceActions?: PortalExperienceActions
  /** The writes of a portal's own look (Look section). Absent: the section never offers them. */
  portalLookActions?: PortalLookActions
  /** The route's pending reads. Absent: every resource is already in hand. */
  reads?: Partial<Record<PortalEditorReadKey, PortalEditorRead>>
}>

/** What every section receives: the route's resources and whether the viewer may edit. */
export type PortalEditorSectionProps = Readonly<{
  resources: PortalEditorResources
  /** `portal.update` and the `portal.write` capability held, and the portal not archived. */
  canEdit: boolean
}>
