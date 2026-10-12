import type { StatusMap } from '#/components/ui/status-badge'

/**
 * How an invitation's state reads as a pill. The vocabulary is the identity
 * domain's `InvitationState`, redeclared here because components do not import
 * domain modules; a row whose status is outside it reads as a neutral "Unknown".
 */
export const INVITATION_STATUS: StatusMap<
  'pending' | 'expired' | 'accepted' | 'rejected' | 'canceled'
> = {
  pending: { label: 'Pending', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'positive' },
  rejected: { label: 'Declined', tone: 'negative' },
  canceled: { label: 'Canceled', tone: 'neutral' },
}
