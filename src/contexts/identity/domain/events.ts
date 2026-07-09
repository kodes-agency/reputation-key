// Identity context — domain events
// Standards: docs/standards.md §1
// Event envelope: eventId auto-generated in constructor, occurredAt caller-provided,
// correlationId optional.

import { newEventId } from '#/shared/domain/event-id'
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
  args: Omit<IdentityOrganizationCreated, '_tag' | 'eventId' | 'correlationId'>,
): IdentityOrganizationCreated => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.organizationName.length === 0)
    throw identityError('validation_error', 'organizationName required')
  return {
    _tag: 'identity.organization.created',
    eventId: newEventId(),
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
  invitationId: InvitationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberInvited = (
  args: Omit<IdentityMemberInvited, '_tag' | 'eventId' | 'correlationId'>,
): IdentityMemberInvited => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.userId === '') throw identityError('validation_error', 'userId required')
  return {
    _tag: 'identity.member.invited',
    eventId: newEventId(),
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
  propertyIds: ReadonlyArray<string>
  occurredAt: Date
  correlationId: string | null
}>
export const identityInvitationAccepted = (
  args: Omit<IdentityInvitationAccepted, '_tag' | 'eventId' | 'correlationId'>,
): IdentityInvitationAccepted => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.accepted',
    eventId: newEventId(),
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
  args: Omit<IdentityInvitationRejected, '_tag' | 'eventId' | 'correlationId'>,
): IdentityInvitationRejected => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.rejected',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type IdentityInvitationCanceled = Readonly<{
  _tag: 'identity.invitation.canceled'
  eventId: string
  invitationId: InvitationId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityInvitationCanceled = (
  args: Omit<IdentityInvitationCanceled, '_tag' | 'eventId' | 'correlationId'>,
): IdentityInvitationCanceled => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.canceled',
    eventId: newEventId(),
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
  args: Omit<IdentityMemberRemoved, '_tag' | 'eventId' | 'correlationId'>,
): IdentityMemberRemoved => {
  if (!(args.occurredAt instanceof Date))
    throw identityError('validation_error', 'occurredAt must be Date')
  if (args.userId === '') throw identityError('validation_error', 'userId required')
  return {
    _tag: 'identity.member.removed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type IdentityMemberRoleChanged = Readonly<{
  _tag: 'identity.member.role_changed'
  eventId: string
  organizationId: OrganizationId
  memberUserId: UserId
  previousRole: Role
  newRole: Role
  userId: UserId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberRoleChanged = (
  args: Omit<IdentityMemberRoleChanged, '_tag' | 'eventId' | 'correlationId'>,
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
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type IdentityEvent =
  | IdentityOrganizationCreated
  | IdentityMemberInvited
  | IdentityInvitationAccepted
  | IdentityInvitationRejected
  | IdentityInvitationCanceled
  | IdentityMemberRemoved
  | IdentityMemberRoleChanged
