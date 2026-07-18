// Identity context — domain events
// Standards: docs/standards.md §1
// Event envelope: eventId auto-generated in constructor, occurredAt caller-provided,
// correlationId optional.

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.accepted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

// BQC-3.9: identity.invitation.rejected retired — never emitted (constructor
// only), never schema-registered, no consumers. The event type and its
// catalogue row are gone; guard suites enforce consistency both ways.

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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
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
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.previousRole !== args.newRole,
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
  | IdentityInvitationCanceled
  | IdentityMemberRemoved
  | IdentityMemberRoleChanged
