// Identity context — public API surface for cross-context consumers.
// Shared infrastructure (event bus) and other contexts consume event
// types and port interfaces from this barrel. Per ADR-0001.

export {
  identityOrganizationCreated,
  identityMemberInvited,
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberRemoved,
  identityMemberRoleChanged,
  identityMerchantAiChanged,
} from '../domain/events'
export type {
  IdentityOrganizationCreated,
  IdentityMemberInvited,
  IdentityInvitationAccepted,
  IdentityInvitationCanceled,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
  IdentityMerchantAiChanged,
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
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from './ports/identity.port'
