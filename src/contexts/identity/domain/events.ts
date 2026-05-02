// Identity context — domain events
// Per architecture: "Events are facts, named in the past tense."
// Events live in their owning context's domain/events.ts.

import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

export type IdentityEvent =
  | OrganizationCreated
  | MemberInvited
  | InvitationAccepted
  | InvitationRejected
  | MemberRemoved
  | MemberRoleChanged

// fallow-ignore-next-line unused-type
export type OrganizationCreated = Readonly<{
  _tag: 'organization.created'
  organizationId: OrganizationId
  organizationName: string
  slug: string
  ownerId: UserId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type MemberInvited = Readonly<{
  _tag: 'member.invited'
  organizationId: OrganizationId
  email: string
  role: Role
  inviterId: UserId
  invitationId: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InvitationAccepted = Readonly<{
  _tag: 'invitation.accepted'
  organizationId: OrganizationId
  userId: UserId
  role: Role
  invitationId: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InvitationRejected = Readonly<{
  _tag: 'invitation.rejected'
  organizationId: OrganizationId
  invitationId: string
  email: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type MemberRemoved = Readonly<{
  _tag: 'member.removed'
  organizationId: OrganizationId
  userId: UserId
  removedBy: UserId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type MemberRoleChanged = Readonly<{
  _tag: 'member.role-changed'
  organizationId: OrganizationId
  userId: UserId
  previousRole: Role
  newRole: Role
  changedBy: UserId
  occurredAt: Date
}>

// ── Event constructors ──────────────────────────────────────────────

export const organizationCreated = (
  args: Omit<OrganizationCreated, '_tag'>,
): OrganizationCreated => ({ _tag: 'organization.created', ...args })

export const memberInvited = (args: Omit<MemberInvited, '_tag'>): MemberInvited => ({
  _tag: 'member.invited',
  ...args,
})

export const memberRemoved = (args: Omit<MemberRemoved, '_tag'>): MemberRemoved => ({
  _tag: 'member.removed',
  ...args,
})

export const memberRoleChanged = (
  args: Omit<MemberRoleChanged, '_tag'>,
): MemberRoleChanged => ({ _tag: 'member.role-changed', ...args })
