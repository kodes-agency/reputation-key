import type { StatusMap } from '#/components/ui/status-badge'
import { LINK_APPROVAL_NAMES } from '../link-tree/linktree-approval-names'
import type { PortalApprovedDestinationList } from './portal-experience-settings-types'

type Site = PortalApprovedDestinationList['destinations'][number]
type ApprovalState = Site['approvalState']

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

/**
 * The second line of the list's heading: how many sites wait for an answer, or,
 * when none does, how many there are ("1 site", "3 sites").
 */
export function describeWaitingSites(
  sites: ReadonlyArray<Pick<Site, 'approvalState'>>,
): string {
  const waiting = sites.filter((site) => site.approvalState === 'pending').length
  if (waiting > 0) return `${waiting} waiting for approval`
  return `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`
}
