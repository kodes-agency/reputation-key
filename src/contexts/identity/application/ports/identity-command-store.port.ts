// Identity command store — atomic identity state mutation + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the better-auth-owned state rows
// (invitation / member / organization — the app-owned write path, same
// precedent as the pre-existing acceptInvitation transaction) and the
// outbox_events fact in ONE PostgreSQL transaction, then emits on the
// in-process bus after commit (expand-phase dual path until the durable
// switch).

import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import type {
  IdentityInvitationAccepted,
  IdentityInvitationCanceled,
  IdentityMemberInvited,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
  IdentityOrganizationCreated,
} from '../../domain/events'

/** Result of an accepted invitation: the joined org + invited property ids. */
export type AcceptedInvitation = Readonly<{
  organizationId: OrganizationId
  propertyIds: ReadonlyArray<string>
}>

/**
 * Invite a member: invitation row insert + member.invited fact in one
 * transaction. Guards (matching better-auth's createInvitation semantics):
 * the invitee must not already be a member of the org, and must not have a
 * pending invitation — both throw `already_exists` and record NO fact.
 */
export type InviteMemberCommand = Readonly<{
  invitationId: InvitationId
  organizationId: OrganizationId
  email: string
  /** Better-auth role string persisted on the invitation ('owner'|'admin'|'member'). */
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
}>

/**
 * Cancel a sent invitation: status update + invitation.canceled fact in one
 * transaction. Throws `invitation_not_found` when no row matches
 * (id + organizationId) — records NO fact.
 */
export type CancelInvitationCommand = Readonly<{
  invitationId: InvitationId
  organizationId: OrganizationId
  event: IdentityInvitationCanceled
}>

/**
 * Remove a member: org advisory lock + member delete + member.removed fact
 * in one transaction. The last-owner invariant is re-enforced under the lock
 * (throws `last_owner`); a missing row throws `member_not_found` — both
 * record NO fact.
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
  /** Better-auth role string persisted on the member row ('owner'|'admin'|'member'). */
  newRole: string
  event: IdentityMemberRoleChanged
}>

/**
 * Register an organization with its owner: organization row + owner member
 * row + organization.created fact in one transaction. A slug conflict throws
 * `already_exists` and records NO fact.
 */
export type RegisterOrganizationCommand = Readonly<{
  organizationId: OrganizationId
  organizationName: string
  slug: string
  ownerId: UserId
  now: Date
  event: IdentityOrganizationCreated
}>

export type IdentityCommandStore = Readonly<{
  inviteMember(command: InviteMemberCommand): Promise<void>
  acceptInvitation(command: AcceptInvitationCommand): Promise<AcceptedInvitation>
  cancelInvitation(command: CancelInvitationCommand): Promise<void>
  removeMember(command: RemoveMemberCommand): Promise<void>
  changeMemberRole(command: ChangeMemberRoleCommand): Promise<void>
  registerOrganization(command: RegisterOrganizationCommand): Promise<void>
}>
