// Identity context — domain events
// Standards: docs/standards.md §1
// Event envelope: eventId auto-generated in constructor, occurredAt caller-provided,
// correlationId optional.

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { OrganizationId, UserId, InvitationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { MerchantAiState } from './merchant-ai-authorization'
import type { OrganizationLifecycleState } from './organization-lifecycle'

type IdentityEventArgs<T> = Omit<T, '_tag' | 'eventId' | 'correlationId'> &
  Readonly<{ correlationId?: string | null }>

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
  args: IdentityEventArgs<IdentityOrganizationCreated>,
): IdentityOrganizationCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.organizationName.length > 0, 'organizationName required')
  return {
    _tag: 'identity.organization.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IdentityMemberInvited = Readonly<{
  _tag: 'identity.member.invited'
  eventId: string
  organizationId: OrganizationId
  userId: UserId
  role: Role
  invitationId: InvitationId
  occurredAt: Date
  correlationId: string | null
}>
export const identityMemberInvited = (
  args: IdentityEventArgs<IdentityMemberInvited>,
): IdentityMemberInvited => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
  return {
    _tag: 'identity.member.invited',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
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
  args: IdentityEventArgs<IdentityInvitationAccepted>,
): IdentityInvitationAccepted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.accepted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
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
  args: IdentityEventArgs<IdentityInvitationCanceled>,
): IdentityInvitationCanceled => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'identity.invitation.canceled',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
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
  args: IdentityEventArgs<IdentityMemberRemoved>,
): IdentityMemberRemoved => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
  return {
    _tag: 'identity.member.removed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
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
  args: IdentityEventArgs<IdentityMemberRoleChanged>,
): IdentityMemberRoleChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.previousRole !== args.newRole,
    'Role change must transition to different role',
  )
  return {
    _tag: 'identity.member.role_changed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IdentityMerchantAiChanged = Readonly<{
  _tag: 'identity.merchant_ai.changed'
  eventId: string
  organizationId: OrganizationId
  propertyId: string
  authorizationLineageId: string
  state: MerchantAiState
  reviewAnalysisEpoch: number
  replyDraftingEpoch: number
  propertyTrendsEpoch: number
  authorizedSourceEpoch: number
  analysisStartSequence: number
  stateVersion: number
  occurredAt: Date
  correlationId: string | null
}>

export const identityMerchantAiChanged = (
  args: IdentityEventArgs<IdentityMerchantAiChanged>,
): IdentityMerchantAiChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.authorizationLineageId.length > 0, 'authorizationLineageId required')
  assert(
    Number.isSafeInteger(args.reviewAnalysisEpoch) && args.reviewAnalysisEpoch >= 1,
    'reviewAnalysisEpoch must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.replyDraftingEpoch) && args.replyDraftingEpoch >= 1,
    'replyDraftingEpoch must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.propertyTrendsEpoch) && args.propertyTrendsEpoch >= 1,
    'propertyTrendsEpoch must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.stateVersion) && args.stateVersion >= 1,
    'stateVersion must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.authorizedSourceEpoch) && args.authorizedSourceEpoch >= 0,
    'authorizedSourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.analysisStartSequence) && args.analysisStartSequence >= 0,
    'analysisStartSequence must be a nonnegative safe integer',
  )
  return {
    _tag: 'identity.merchant_ai.changed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IdentityOrganizationLifecycleChanged = Readonly<{
  _tag: 'identity.organization_lifecycle.changed'
  eventId: string
  organizationId: OrganizationId
  closureLineageId: string
  state: OrganizationLifecycleState
  revision: number
  reactivationRequired: boolean
  recoverableUntil: Date
  occurredAt: Date
  correlationId: string | null
}>

export const identityOrganizationLifecycleChanged = (
  args: IdentityEventArgs<IdentityOrganizationLifecycleChanged>,
): IdentityOrganizationLifecycleChanged => {
  assert(
    args.occurredAt instanceof Date && !Number.isNaN(args.occurredAt.getTime()),
    'occurredAt must be a valid Date',
  )
  assert(
    args.recoverableUntil instanceof Date &&
      !Number.isNaN(args.recoverableUntil.getTime()),
    'recoverableUntil must be a valid Date',
  )
  assert(args.organizationId !== '', 'organizationId required')
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      args.closureLineageId,
    ),
    'closureLineageId must be UUID',
  )
  assert(
    Number.isSafeInteger(args.revision) && args.revision > 0,
    'revision must be a positive safe integer',
  )
  assert(args.reactivationRequired, 'lifecycle transition must require reactivation')
  return {
    _tag: 'identity.organization_lifecycle.changed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type IdentityEvent =
  | IdentityOrganizationCreated
  | IdentityMemberInvited
  | IdentityInvitationAccepted
  | IdentityInvitationCanceled
  | IdentityMemberRemoved
  | IdentityMemberRoleChanged
  | IdentityMerchantAiChanged
  | IdentityOrganizationLifecycleChanged
