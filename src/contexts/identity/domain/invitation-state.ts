// Identity context — the lifecycle state an invitation reads as.
//
// Better Auth stores `invitation.status` as free text. A row stays stored as
// 'pending' after its expiry passes (nothing sweeps it), and inviting the same
// address to another Organization writes 'expired' onto a lapsed row. Every
// reader derives the state here so "expired" means the same thing everywhere.

import {
  isBetaInteractiveRole,
  type BetaInteractiveRole,
} from '#/shared/domain/beta-interactive-role'
import { toDomainRole } from '#/shared/domain/roles'

export type InvitationState = 'pending' | 'expired' | 'accepted' | 'rejected' | 'canceled'

const MS_PER_DAY = 86_400_000

/** Stored 'pending' with expiresAt <= now reads as 'expired'. Unknown status → null. */
export function invitationState(
  status: string,
  expiresAt: Date,
  now: Date,
): InvitationState | null {
  switch (status) {
    case 'pending':
      return expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending'
    case 'expired':
    case 'accepted':
    case 'rejected':
    case 'canceled':
      return status
    default:
      return null
  }
}

/**
 * The whole number of days an invitation lifetime promises in copy. Resend
 * renews the invitation, so the promise is true at every send.
 */
export const invitationExpiresInDays = (ms: number): number =>
  Math.max(1, Math.round(ms / MS_PER_DAY))

/**
 * The beta manager role an invitation's raw Better Auth token grants, or null
 * for a token no beta login may hold (Member, custom, multi-role).
 */
export function betaInvitationRole(raw: string | null): BetaInteractiveRole | null {
  const role = toDomainRole((raw ?? '').trim().toLowerCase())
  return role !== null && isBetaInteractiveRole(role) ? role : null
}
