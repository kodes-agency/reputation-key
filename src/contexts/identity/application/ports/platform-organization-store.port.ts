// Identity context — the platform operator console's Organization store
// (ADR 0063).
//
// Reads every Organization across tenants (the console is the only caller),
// creates one without making the operator its member, and runs the console's
// invitation changes. Uses the Identity-owned tables organization, member,
// invitation and organization_lifecycle_authority, and writes `audit_logs`.
//
// Every change commits an `audit_logs` row in the same transaction: the
// Organization, the operator's user id and the action. Log lines and spans
// carry no identifiers, and `identity.invitation.canceled` names no actor, so
// that row is the only durable record of who made a console change.

import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { OrganizationLifecycleState } from '../../domain/organization-lifecycle'
import type {
  CancelInvitationCommand,
  InviteMemberCommand,
  RenewedInvitation,
  RenewInvitationCommand,
} from './identity-command-store.port'

/** An open AccountAdmin invitation: role 'owner', stored 'pending' or 'expired'. */
export type PlatformAdminInvitationRow = Readonly<{
  id: InvitationId
  email: string
  /** The stored status; invitationState derives whether it reads expired. */
  status: string
  expiresAt: Date
}>

export type PlatformOrganizationRow = Readonly<{
  id: OrganizationId
  name: string
  slug: string
  createdAt: Date
  lifecycleState: OrganizationLifecycleState
  memberCount: number
  /** Members holding the 'owner' role token. */
  accountAdminCount: number
  /** Invitations of any role stored 'pending' and not past expiry at `now`. */
  pendingInvitationCount: number
  /** Newest first. */
  adminInvitations: ReadonlyArray<PlatformAdminInvitationRow>
}>

/** What the console needs to decide whether it may act on an Organization. */
export type OrganizationAdministration = Readonly<{
  organizationId: OrganizationId
  name: string
  lifecycleState: OrganizationLifecycleState
  accountAdminCount: number
  /** Ids of its open AccountAdmin invitations — the only ones the console touches. */
  openAdminInvitationIds: ReadonlyArray<InvitationId>
}>

/**
 * Create an Organization and invite its first AccountAdmin in ONE transaction:
 * the Organization row (its lifecycle authority row comes from the insert
 * trigger), the invitation row, its `identity.member.invited` fact and the
 * `platform.organization_provisioned` audit row. The operator is the inviter,
 * whom the audit row names, and never becomes a member. A slug already in use
 * → `already_exists`; a refused invitation (the address belongs to or is
 * invited by another Organization) rolls the Organization back too.
 */
export type ProvisionOrganizationCommand = Readonly<{
  organizationId: OrganizationId
  name: string
  slug: string
  now: Date
  firstAdmin: InviteMemberCommand
}>

export type PlatformOrganizationStore = Readonly<{
  /** Newest first, at most `limit`. */
  listOrganizations(
    input: Readonly<{ limit: number; now: Date }>,
  ): Promise<ReadonlyArray<PlatformOrganizationRow>>
  /** Null when the Organization does not exist. */
  readAdministration(
    organizationId: OrganizationId,
  ): Promise<OrganizationAdministration | null>
  provisionOrganization(command: ProvisionOrganizationCommand): Promise<void>
  /**
   * The ordinary invitation command and a `platform.admin_invited` audit row
   * naming its inviter (the operator), in one transaction.
   */
  inviteAdmin(command: InviteMemberCommand): Promise<void>
  /**
   * The ordinary renewal and a `platform.admin_invitation_resent` audit row
   * naming the operator, in one transaction.
   */
  renewAdminInvitation(
    command: RenewInvitationCommand,
    operatorUserId: UserId,
  ): Promise<RenewedInvitation>
  /**
   * The ordinary cancellation, its `identity.invitation.canceled` fact and a
   * `platform.admin_invitation_canceled` audit row naming the operator, in one
   * transaction.
   */
  cancelAdminInvitation(
    command: CancelInvitationCommand,
    operatorUserId: UserId,
  ): Promise<void>
}>
