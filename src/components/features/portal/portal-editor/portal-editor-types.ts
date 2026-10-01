// Prop shapes shared by the editor and its sections.

import type { PortalDetailResources } from '../portal-detail/portal-detail-types'
import type { PortalThemeDraft } from '../shared/types'

/**
 * What the editor reads from the route's resources: everything except what the
 * Share, Results and History tabs consume, so the editor cannot come to depend
 * on them (and a story or test need not invent them).
 */
export type PortalEditorResources = Omit<
  PortalDetailResources,
  | 'publicationHistory'
  | 'loadMorePublicationHistory'
  | 'issueTokenMutation'
  | 'rotateTokenMutation'
  | 'revokeTokenMutation'
  | 'revealAddressMutation'
  | 'tokenStatus'
  | 'getPortalAnalytics'
>

/** What every section receives: the route's resources and whether the viewer may edit. */
export type PortalEditorSectionProps = Readonly<{
  resources: PortalEditorResources
  /** `portal.update` held and the portal not archived. */
  canEdit: boolean
}>

/** The palette draft, which outlives a section switch, so the page owns it. */
export type PortalEditorThemeControls = Readonly<{
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
}>
