import type { StatusMap } from '#/components/ui/status-badge'
import { LINK_APPROVAL_NAMES } from '../link-tree/linktree-approval-names'
import type { PortalApprovedDestinationList } from './portal-experience-settings-types'

type ApprovalState =
  PortalApprovedDestinationList['destinations'][number]['approvalState']

/**
 * How a site allowed for links reads as a pill. The words are the tile's own
 * (linktree-approval-names.ts), so a state has one name wherever it is met.
 */
export const APPROVED_DESTINATION_STATUS: StatusMap<ApprovalState> = {
  approved: { label: LINK_APPROVAL_NAMES.approved, tone: 'positive' },
  pending: { label: LINK_APPROVAL_NAMES.pending, tone: 'warn' },
  disabled: { label: LINK_APPROVAL_NAMES.disabled, tone: 'neutral' },
  quarantined: { label: LINK_APPROVAL_NAMES.quarantined, tone: 'negative' },
}

/** Why a site held back for safety is not shown to guests, and what to do. */
export const HELD_BACK_EXPLANATION =
  'Held back by our safety checks, so guests do not see links to it. Contact support if this is your site.'
