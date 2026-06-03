// Identity context — public API surface for cross-context consumers.
// Shared infrastructure (event bus) and other contexts consume event
// types and port interfaces from this barrel. Per ADR-0001.

export {
  identityOrganizationCreated,
  identityMemberInvited,
  identityMemberRemoved,
  identityMemberRoleChanged,
} from '../domain/events'
export type {
  IdentityOrganizationCreated,
  IdentityMemberInvited,
  IdentityInvitationAccepted,
  IdentityInvitationRejected,
  IdentityMemberRemoved,
  IdentityMemberRoleChanged,
  IdentityEvent,
} from '../domain/events'

export type {
  IdentityPort,
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from './ports/identity.port'
