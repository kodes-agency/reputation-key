// Identity context — the platform operator console's Organization store
// (ADR 0063).
//
// Reads every Organization across tenants (the console is the only caller)
// and creates one without making the operator its member. Uses only
// Identity-owned tables: organization, member, invitation and
// organization_lifecycle_authority.

import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import type { OrganizationLifecycleState } from '../../domain/organization-lifecycle'
import type { InviteMemberCommand } from './identity-command-store.port'

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
 * trigger), the invitation row and its `identity.member.invited` fact. The
 * operator is the inviter and never becomes a member. A slug already in use
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
}>
