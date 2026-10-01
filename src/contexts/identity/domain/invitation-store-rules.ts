// Identity context — the pure rules over stored invitation rows.
//
// The Postgres command store reads and writes the better-auth invitation and
// member tables; its in-memory test fake keeps the same rows in maps. Both run
// the guards below, so what the fake accepts or refuses is what the store does,
// and the two cannot drift. Each guard takes plain row data and either returns
// or throws the tagged identity error: no database, no clock of its own.

import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'
import {
  organizationId as toOrganizationId,
  userId as toUserId,
} from '#/shared/domain/ids'
import { identityError } from './errors'
import { invitationState } from './invitation-state'
import {
  INELIGIBLE_ROLE_MESSAGE,
  INVITATION_CONSUMED_MESSAGE,
  INVITATION_EXPIRED_MESSAGE,
  INVITATION_INACTIVE_MESSAGE,
  INVITATION_OTHER_ADDRESS_MESSAGE,
} from './invitation-copy'

// ── Row encoding ────────────────────────────────────────────────────

/** Parse the JSON-encoded propertyIds string from an invitation row. */
export function parsePropertyIds(raw: string | null): ReadonlyArray<string> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === 'string')
      : []
  } catch {
    return []
  }
}

/** The invitation row's propertyIds column: null when no Property is granted. */
export const encodePropertyIds = (propertyIds: ReadonlyArray<string>): string | null =>
  propertyIds.length > 0 ? JSON.stringify(propertyIds) : null

/**
 * The role token an invitation row grants, when a beta login may hold it
 * (owner or admin); null for a Member or custom role, which are retained as
 * data but never become logins.
 */
export function grantedRoleToken(raw: string | null): string | null {
  const role = (raw ?? 'member').trim().toLowerCase()
  return isBetaInteractiveMemberRoleToken(role) ? role : null
}

/** What an acceptance reports from the invitation row it consumed. */
export const consumedInvitation = (
  row: Readonly<{
    organizationId: string
    propertyIds: string | null
    inviterId: string | null
  }>,
) => ({
  organizationId: toOrganizationId(row.organizationId),
  propertyIds: parsePropertyIds(row.propertyIds),
  inviterId: row.inviterId ? toUserId(row.inviterId) : null,
})

// ── Read-only registration preflight ────────────────────────────────

/**
 * The preflight before an account is created: the invitation is still
 * pending, addressed to this email, and grants a role a beta login may hold.
 */
export function assertInvitationOpenForRegistration(
  inv:
    | Readonly<{
        email: string
        role: string | null
        status: string
        expiresAt: Date
      }>
    | undefined,
  input: Readonly<{ email: string; now: Date }>,
): void {
  if (!inv || inv.status !== 'pending' || inv.expiresAt <= input.now) {
    throw identityError('invitation_not_found', 'Invitation is not available')
  }
  if (inv.email.toLowerCase() !== input.email.toLowerCase()) {
    throw identityError('forbidden', 'Invitation is not addressed to this email')
  }
  if (!isBetaInteractiveMemberRoleToken(inv.role ?? 'member')) {
    throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
  }
}

// ── Acceptance and renewal ──────────────────────────────────────────

/**
 * Only the invitee may accept (`acceptorEmail` is already lower-cased), and
 * only while the invitation is pending. The copy is fixed: it reaches the
 * invitee.
 */
export function assertInvitationAcceptable(
  inv: Readonly<{ email: string; status: string; expiresAt: Date }>,
  acceptorEmail: string,
  now: Date,
): void {
  if (inv.email.toLowerCase() !== acceptorEmail) {
    throw identityError('forbidden', INVITATION_OTHER_ADDRESS_MESSAGE)
  }
  const state = invitationState(inv.status, inv.expiresAt, now)
  if (state === 'expired') {
    throw identityError('invitation_expired', INVITATION_EXPIRED_MESSAGE)
  }
  if (state !== 'pending') {
    throw identityError('invitation_not_found', INVITATION_INACTIVE_MESSAGE)
  }
}

/**
 * Resend renews an open invitation (stored pending or expired) whose role a
 * beta login may still hold. Returns the row with that role token.
 */
export function renewableInvitation<
  T extends Readonly<{ status: string; role: string | null }>,
>(inv: T | undefined): Readonly<{ inv: T; role: string }> {
  if (!inv || (inv.status !== 'pending' && inv.status !== 'expired')) {
    throw identityError('invitation_not_found', INVITATION_CONSUMED_MESSAGE)
  }
  const role = grantedRoleToken(inv.role)
  if (role === null) throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
  return { inv, role }
}

// ── Address-level guards ────────────────────────────────────────────

/**
 * Guard 1 — an existing membership of the address must either be the current
 * org (duplicate) or another org (closed-beta Organization conflict).
 */
export function assertAddressHasNoMembership(
  memberOrganizationIds: ReadonlyArray<string>,
  organizationId: string,
): void {
  if (memberOrganizationIds.some((id) => id === organizationId)) {
    throw identityError('already_exists', 'User is already a member of this organization')
  }
  if (memberOrganizationIds.length > 0) {
    throw identityError(
      'organization_conflict',
      'This account already belongs to another Organization',
    )
  }
}

/** An invitation of an address that is still open, read as its state. */
export type OpenInvitation = Readonly<{
  id: string
  organizationId: string
  state: 'pending' | 'expired'
  storedStatus: string
}>

/** The invitation as an open one, or none when it is accepted, rejected, cancelled or unknown. */
export function toOpenInvitations(
  row: Readonly<{
    id: string
    organizationId: string
    status: string
    expiresAt: Date
  }>,
  now: Date,
): ReadonlyArray<OpenInvitation> {
  const state = invitationState(row.status, row.expiresAt, now)
  return state === 'pending' || state === 'expired'
    ? [
        {
          id: row.id,
          organizationId: row.organizationId,
          state,
          storedStatus: row.status,
        },
      ]
    : []
}

/**
 * Guard 2 — only one Organization may hold a live beta manager invitation for
 * an address. A lapsed row of this Organization is renewed with Resend rather
 * than duplicated; another Organization's lapsed row is marked 'expired' (no
 * fact) so it stops blocking the address. Returns the ids to mark.
 */
export function lapsedCompetitorIds(
  open: ReadonlyArray<OpenInvitation>,
  organizationId: string,
): ReadonlyArray<string> {
  const mine = open.filter((row) => row.organizationId === organizationId)
  const theirs = open.filter((row) => row.organizationId !== organizationId)
  if (mine.some((row) => row.state === 'pending')) {
    throw identityError('already_exists', 'User is already invited to this organization')
  }
  if (mine.length > 0) {
    throw identityError(
      'already_exists',
      'This email has an expired invitation. Use Resend to renew it.',
    )
  }
  if (theirs.some((row) => row.state === 'pending')) {
    throw identityError(
      'organization_conflict',
      'This email already has a pending invitation from another Organization',
    )
  }
  return theirs.filter((row) => row.storedStatus === 'pending').map((row) => row.id)
}

/**
 * The renewed row must not compete with a live invitation elsewhere: another
 * Organization may have invited the address while this one lapsed.
 */
export function assertRenewalHasNoCompetitor(
  open: ReadonlyArray<OpenInvitation>,
  renewed: Readonly<{ id: string; organizationId: string }>,
): void {
  const live = open.filter((row) => row.id !== renewed.id && row.state === 'pending')
  if (live.some((row) => row.organizationId === renewed.organizationId)) {
    throw identityError('already_exists', 'User is already invited to this organization')
  }
  if (live.length > 0) {
    throw identityError(
      'organization_conflict',
      'This email already has a pending invitation from another Organization',
    )
  }
}
