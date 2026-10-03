import type { StatusMap } from '#/components/ui/status-badge'
import type { PortalApprovedDestinationList } from './portal-experience-settings-types'

type ApprovalState =
  PortalApprovedDestinationList['destinations'][number]['approvalState']

/** How a link destination's approval reads as a pill. */
export const APPROVED_DESTINATION_STATUS: StatusMap<ApprovalState> = {
  approved: { label: 'Approved', tone: 'positive' },
  pending: { label: 'Waiting for approval', tone: 'warn' },
  disabled: { label: 'Disabled', tone: 'neutral' },
  quarantined: { label: 'Quarantined', tone: 'negative' },
}
