// Identity context — public API surface for cross-context consumers.
// Shared infrastructure (event bus) and other contexts consume event
// types and port interfaces from this barrel. Per ADR-0001.

import type { ManagerMembership } from './ports/identity.port'
import type { OutstandingResponsibility } from './ports/member-offboarding.port'
import type { InviteMember } from './use-cases/invite-member'
import type { UpdateMemberRole } from './use-cases/update-member-role'
import type { RemoveMember } from './use-cases/remove-member'
import type { LeaveOrganization } from './use-cases/leave-organization'
import type { ListInvitations } from './use-cases/list-invitations'
import type { ResendInvitation } from './use-cases/resend-invitation'
import type { AcceptInvitation } from './use-cases/accept-invitation'
import type { CancelInvitation } from './use-cases/cancel-invitation'
import type { RegisterInvitedUser } from './use-cases/register-invited-user'
import type { RegisterUserAndOrg } from './use-cases/register-user-and-org'
import type { UpdateOrganization } from './use-cases/update-organization'
import type { CreateCustomRole } from './use-cases/create-custom-role'
import type { UpdateCustomRole } from './use-cases/update-custom-role'
import type { DeleteCustomRole } from './use-cases/delete-custom-role'
import type { MerchantAiAuthorization } from './use-cases/merchant-ai-authorization'

export type {
  IdentityOrganizationCreated,
  IdentityMemberInvited,
  IdentityInvitationAccepted,
  IdentityInvitationCanceled,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
  IdentityMerchantAiChanged,
  IdentityOrganizationLifecycleChanged,
  IdentityEvent,
} from '../domain/events'

export {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type CurrentMerchantAiCapability,
  type MerchantAiCapability,
  type MerchantAiSnapshot,
  type MerchantAiState,
} from '../domain/merchant-ai-authorization'

export type {
  IdentityPort,
  InvitationRecord,
  ManagerMembership,
  MemberRecord,
  OrganizationRecord,
} from './ports/identity.port'

/** Current manager membership facts. This facade carries no mutation authority. */
export type IdentityManagerFactsPublicApi = Readonly<{
  listActiveManagers: (organizationId: string) => Promise<readonly ManagerMembership[]>
}>

/** Current AccountAdmin authority, kept separate from general membership facts. */
export type IdentityAccountAdminAuthorityPublicApi = Readonly<{
  isCurrentAccountAdmin: (
    input: Readonly<{
      organizationId: string
      userId: string
    }>,
  ) => Promise<boolean>
}>

/** Request-facing Identity operations. Infrastructure and worker controls stay private. */
export type IdentityRequestApi = Readonly<{
  inviteMember: InviteMember
  updateMemberRole: UpdateMemberRole
  removeMember: RemoveMember
  /**
   * LIF-01-T21. Voluntary departure is deliberately a SEPARATE operation from
   * `removeMember`: removal releases what the member held, leaving requires
   * every responsibility to be handed over first.
   */
  leaveOrganization: LeaveOrganization
  listInvitations: ListInvitations
  resendInvitation: ResendInvitation
  acceptInvitation: AcceptInvitation
  cancelInvitation: CancelInvitation
  registerInvitedUser: RegisterInvitedUser
  registerUserAndOrg: RegisterUserAndOrg
  updateOrganization: UpdateOrganization
  createCustomRole: CreateCustomRole
  updateCustomRole: UpdateCustomRole
  deleteCustomRole: DeleteCustomRole
  merchantAiAuthorization: MerchantAiAuthorization
}>

/**
 * The transfer worklist a departing member must clear (LIF-01-T21). Read-only
 * and identifier-only; it grants no authority to release anything.
 */
export type IdentityOffboardingFactsPublicApi = Readonly<{
  listOutstanding: (
    organizationId: string,
    userId: string,
  ) => Promise<readonly OutstandingResponsibility[]>
}>

/** Complete delivery-boundary facade used by Identity request handlers. */
export type IdentityPublicApi = Readonly<{
  managerFacts: IdentityManagerFactsPublicApi
  accountAdminAuthority: IdentityAccountAdminAuthorityPublicApi
  offboardingFacts: IdentityOffboardingFactsPublicApi
  requests: IdentityRequestApi
}>
