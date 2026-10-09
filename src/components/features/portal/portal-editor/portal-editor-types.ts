// Prop shapes shared by the editor and its sections.

import type { PortalDetailResources } from '../portal-detail/portal-detail-types'

/**
 * What the editor reads from the route's resources: everything except what the
 * Share, Results and History tabs consume, so the editor cannot come to depend
 * on them (and a story or test need not invent them). The publication history
 * stays: the link check names the live version it covers.
 */
export type PortalEditorResources = Omit<
  PortalDetailResources,
  | 'historyReads'
  | 'makeVersionLiveMutation'
  | 'propertyTimeZone'
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
