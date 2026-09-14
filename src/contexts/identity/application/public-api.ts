// Identity context — public API surface for cross-context consumers.
// Other contexts consume event types and port interfaces from this barrel.
// Per ADR-0001.

import type { ManagerMembership } from './ports/identity.port'
import type { StaffPublicApi } from './people-public-api'
import type {
  LeaveOrganization,
  OutstandingResponsibility,
} from './use-cases/leave-organization'
import type { InviteMember } from './use-cases/invite-member'
import type { UpdateMemberRole } from './use-cases/update-member-role'
import type { RemoveMember } from './use-cases/remove-member'
import type { ListInvitations } from './use-cases/list-invitations'
import type { ResendInvitation } from './use-cases/resend-invitation'
import type { AcceptInvitation } from './use-cases/accept-invitation'
import type { CancelInvitation } from './use-cases/cancel-invitation'
import type { RegisterInvitedUser } from './use-cases/register-invited-user'
import type { UpdateOrganization } from './use-cases/update-organization'
import type { CreateCustomRole } from './use-cases/create-custom-role'
import type { UpdateCustomRole } from './use-cases/update-custom-role'
import type { DeleteCustomRole } from './use-cases/delete-custom-role'
import type { MerchantAiAuthorization } from './use-cases/merchant-ai-authorization'
import type { MerchantAiDecisionDeferralService } from './use-cases/merchant-ai-decision-deferral'
import type { ListMerchantAiOverview } from './use-cases/merchant-ai-overview'

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

export type {
  StaffPublicApi,
  StaffParticipation,
  PortalResponsibility,
} from './people-public-api'
export type {
  OffboardingResponsibilityKind,
  OutstandingResponsibility,
  ResponsibilityTransfer,
} from './use-cases/leave-organization'

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

/**
 * Merchant AI management: the per-Property authorization snapshot and its
 * consent commands, the durable "not now" decision, and the read-only
 * Organization overview across every Property the actor manages AI for.
 */
export type MerchantAiRequestApi = Readonly<
  Pick<MerchantAiAuthorization, 'get' | 'enable' | 'change' | 'revoke'> &
    Pick<MerchantAiDecisionDeferralService, 'defer'> & {
      listOverview: ListMerchantAiOverview
    }
>

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
  updateOrganization: UpdateOrganization
  createCustomRole: CreateCustomRole
  updateCustomRole: UpdateCustomRole
  deleteCustomRole: DeleteCustomRole
  merchantAiAuthorization: MerchantAiRequestApi
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
  people: StaffPublicApi
  requests: IdentityRequestApi
}>
export type {
  MerchantAiOverview,
  MerchantAiOverviewEntry,
} from './use-cases/merchant-ai-overview'
