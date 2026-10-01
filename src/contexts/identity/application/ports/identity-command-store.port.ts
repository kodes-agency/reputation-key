// Identity command store — atomic identity state mutation + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the better-auth-owned state rows
// (invitation / member — the app-owned write path, same precedent as the
// pre-existing acceptInvitation transaction) and the outbox_events fact in one
// PostgreSQL transaction.

import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import type {
  IdentityInvitationAccepted,
  IdentityInvitationCanceled,
  IdentityMemberInvited,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
} from '../../domain/events'

/**
 * Result of an accepted invitation: the joined org, the invited property ids,
 * and who sent it (read under the lock; null only for a row with no inviter).
 */
export type AcceptedInvitation = Readonly<{
  organizationId: OrganizationId
  propertyIds: ReadonlyArray<string>
  inviterId: UserId | null
}>

/** Read-only invitation preflight before an account is created. */
export type ValidateInvitationRegistrationCommand = Readonly<{
  invitationId: InvitationId
  email: string
  now: Date
}>

/**
 * Invite a member: invitation row insert + member.invited fact in one
 * transaction. Guards: the invitee must not already be a member of any
 * Organization (`already_exists` here, `organization_conflict` elsewhere), and
 * must not hold a live pending invitation (`already_exists` here, including a
 * lapsed one — Resend renews it — and `organization_conflict` from another
 * Organization). Another Organization's lapsed row is marked 'expired' and the
 * invite proceeds. Refusals record NO fact.
 */
export type InviteMemberCommand = Readonly<{
  invitationId: InvitationId
  organizationId: OrganizationId
  email: string
  /** Beta interactive Better Auth role persisted on the invitation ('owner'|'admin'). */
  role: string
  inviterId: UserId
  propertyIds: ReadonlyArray<string>
  now: Date
  expiresAt: Date
  event: IdentityMemberInvited
}>

/**
 * Accept an invitation: FOR UPDATE lock + email/lifecycle/role re-validation
 * + member insert + invitation status update + invitation.accepted fact in
 * one transaction. The fact depends on invitation-row data read inside the
 * transaction (org id, property ids), so the caller supplies a factory that
 * the store invokes under the lock.
 */
export type AcceptInvitationCommand = Readonly<{
  invitationId: InvitationId
  /** Lowercase-normalized inside the store before comparison. */
  acceptorEmail: string
  acceptorUserId: UserId
  now: Date
  buildEvent: (accepted: AcceptedInvitation) => IdentityInvitationAccepted
  /**
   * Registration paths only: consuming the emailed link proves the inbox, so
   * the acceptor's user row is marked email-verified in the same transaction.
   * A missing or differently addressed user row rolls the acceptance back.
   * The signed-in accept path never sets it — that user proved nothing about
   * the address.
   */
  markEmailVerified?: boolean
}>

/**
 * Renew an invitation (Resend): the same row gets a new expiry and reads
 * pending again. Accepts a stored 'pending' row (live or lapsed) or an
 * 'expired' row. Takes the email lock, re-runs the membership guard and the
 * other-Organization live-invitation guard, and writes no fact. Anything else
 * → `invitation_not_found`.
 */
export type RenewInvitationCommand = Readonly<{
  invitationId: InvitationId
  organizationId: OrganizationId
  now: Date
  expiresAt: Date
}>

/** What the renewed row says, for the email that follows. */
export type RenewedInvitation = Readonly<{
  email: string
  /** The raw Better Auth role token ('owner' | 'admin'). */
  role: string
  propertyIds: ReadonlyArray<string>
  expiresAt: Date
}>

/**
 * Cancel a sent invitation: status update + invitation.canceled fact in one
 * transaction. Only a pending or expired row can be canceled; throws
 * `invitation_not_found` when no such row matches (id + organizationId) —
 * records NO fact.
 */
export type CancelInvitationCommand = Readonly<{
  invitationId: InvitationId
  organizationId: OrganizationId
  event: IdentityInvitationCanceled
}>

/**
 * Remove a member: org advisory lock + session revocation + member delete +
 * member.removed fact in one transaction. The last-owner invariant is
 * re-enforced under the lock (throws `last_owner`); a missing row throws
 * `member_not_found` — both record NO fact.
 */
export type RemoveMemberCommand = Readonly<{
  organizationId: OrganizationId
  memberId: string
  event: IdentityMemberRemoved
}>

/**
 * Change a member's role: org advisory lock + role update +
 * member.role_changed fact in one transaction. Demoting the last owner
 * throws `last_owner`; a missing row throws `member_not_found` — both
 * record NO fact.
 */
export type ChangeMemberRoleCommand = Readonly<{
  organizationId: OrganizationId
  memberId: string
  /** Beta interactive Better Auth role persisted on the member row ('owner'|'admin'). */
  newRole: string
  event: IdentityMemberRoleChanged
}>

export type IdentityCommandStore = Readonly<{
  validateInvitationRegistration(
    command: ValidateInvitationRegistrationCommand,
  ): Promise<void>
  inviteMember(command: InviteMemberCommand): Promise<void>
  acceptInvitation(command: AcceptInvitationCommand): Promise<AcceptedInvitation>
  renewInvitation(command: RenewInvitationCommand): Promise<RenewedInvitation>
  cancelInvitation(command: CancelInvitationCommand): Promise<void>
  removeMember(command: RemoveMemberCommand): Promise<void>
  changeMemberRole(command: ChangeMemberRoleCommand): Promise<void>
}>
