// Identity context — domain events
// Standards: docs/standards.md §1

import type { OrganizationId, UserId, InvitationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.organizationName.length > 0, 'organizationName required')
  return {
    _tag: 'identity.organization.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type IdentityMemberInvited = Readonly<{
  _tag: 'identity.member.invited'
  eventId: string
  organizationId: OrganizationId
  email: string
  role: Role
  userId: UserId
  invitationId: InvitationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberInvited = (
  args: Omit<IdentityMemberInvited, '_tag' | 'eventId' | 'correlationId'>,
): IdentityMemberInvited => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
  return {
    _tag: 'identity.member.invited',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type IdentityInvitationAccepted = Readonly<{
  _tag: 'identity.invitation.accepted'
  eventId: string
  organizationId: OrganizationId
  userId: UserId
  role: Role
  invitationId: InvitationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityInvitationAccepted = (
  args: Omit<IdentityInvitationAccepted, '_tag' | 'eventId' | 'correlationId'>,
): IdentityInvitationAccepted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.accepted',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type IdentityInvitationRejected = Readonly<{
  _tag: 'identity.invitation.rejected'
  eventId: string
  organizationId: OrganizationId
  invitationId: InvitationId
  email: string
  occurredAt: Date
  correlationId: string | null
}>
export const identityInvitationRejected = (
  args: Omit<IdentityInvitationRejected, '_tag' | 'eventId' | 'correlationId'>,
): IdentityInvitationRejected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.rejected',
    eventId: crypto.randomUUID(),
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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
  return {
    _tag: 'identity.member.removed',
    eventId: crypto.randomUUID(),
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
  args: Omit<IdentityMemberRoleChanged, '_tag' | 'eventId' | 'correlationId'>,
): IdentityMemberRoleChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.previousRole !== args.newRole,
    'Role change must transition to different role',
  )
  return {
    _tag: 'identity.member.role_changed',
    eventId: crypto.randomUUID(),
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
