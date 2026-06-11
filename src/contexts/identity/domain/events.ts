// Identity context — domain events
// Standards: docs/standards.md §1
//
// NOTE: These event types and constructors are defined for future use.
// They are not currently emitted by any handler in the codebase. When
// identity flows (invite, role change, member removal) are migrated to
// the event-driven pattern, the relevant use cases should call these
// constructors and emit via the event bus.

import type { OrganizationId, UserId, InvitationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { identityError } from './errors'

export type IdentityOrganizationCreated = Readonly<{
  _tag: 'identity.organization.created'
  eventId: string
  organizationId: OrganizationId
  organizationName: string
  slug: string
  ownerId: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const identityOrganizationCreated = (
  args: Omit<IdentityOrganizationCreated, '_tag' | 'correlationId'>,
): IdentityOrganizationCreated => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.organizationName.length === 0)
    throw identityError('validation_error', 'organizationName required')
  return {
    _tag: 'identity.organization.created',
    correlationId: null,
    ...args,
  }
}

export type IdentityMemberInvited = Readonly<{
  _tag: 'identity.member.invited'
  eventId: string
  organizationId: OrganizationId
  userId: UserId
  email: string
  role: Role
  invitedBy: UserId
  invitationId: InvitationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberInvited = (
  args: Omit<IdentityMemberInvited, '_tag' | 'correlationId'>,
): IdentityMemberInvited => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.userId === '') throw identityError('validation_error', 'userId required')
  return {
    _tag: 'identity.member.invited',
    correlationId: null,
    ...args,
  }
}

export type IdentityInvitationAccepted = Readonly<{
  _tag: 'identity.invitation.accepted'
  eventId: string
  invitationId: InvitationId
  organizationId: OrganizationId
  userId: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const identityInvitationAccepted = (
  args: Omit<IdentityInvitationAccepted, '_tag' | 'correlationId'>,
): IdentityInvitationAccepted => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.accepted',
    correlationId: null,
    ...args,
  }
}

export type IdentityInvitationRejected = Readonly<{
  _tag: 'identity.invitation.rejected'
  eventId: string
  invitationId: InvitationId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityInvitationRejected = (
  args: Omit<IdentityInvitationRejected, '_tag' | 'correlationId'>,
): IdentityInvitationRejected => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.rejected',
    correlationId: null,
    ...args,
  }
}

export type IdentityMemberRemoved = Readonly<{
  _tag: 'identity.member.removed'
  eventId: string
  organizationId: OrganizationId
  userId: UserId
  removedBy: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberRemoved = (
  args: Omit<IdentityMemberRemoved, '_tag' | 'correlationId'>,
): IdentityMemberRemoved => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.userId === '') throw identityError('validation_error', 'userId required')
  return {
    _tag: 'identity.member.removed',
    correlationId: null,
    ...args,
  }
}

export type IdentityMemberRoleChanged = Readonly<{
  _tag: 'identity.member.role_changed'
  eventId: string
  organizationId: OrganizationId
  userId: UserId
  previousRole: Role
  newRole: Role
  changedBy: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberRoleChanged = (
  args: Omit<IdentityMemberRoleChanged, '_tag' | 'correlationId'>,
): IdentityMemberRoleChanged => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.previousRole === args.newRole)
    throw identityError(
      'validation_error',
      'Role change must transition to different role',
    )
  return {
    _tag: 'identity.member.role_changed',
    correlationId: null,
    ...args,
  }
}

export type IdentityEvent =
  | IdentityOrganizationCreated
  | IdentityMemberInvited
  | IdentityInvitationAccepted
  | IdentityInvitationRejected
  | IdentityMemberRemoved
  | IdentityMemberRoleChanged
