// Administration for the surviving PropertyAccessGrant authority.
//
// A grant or revoke commits with the identity.member.property_access_changed
// fact the Members access edit records, so the member hears about either.
// Every refusal is a tagged IdentityError, here and in the command store: the
// server adapter maps it by its code, never by the wording of a message.

import type { PolicyAdminCommandStore } from './policy-admin-command-store.port.server'
import { organizationId, userId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import { identityMemberPropertyAccessChanged } from '../domain/events'

export type PolicyAdminDeps = Readonly<{
  commandStore: PolicyAdminCommandStore
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

/** The fact for one Property the operator granted or revoked. */
function propertyAccessChanged(
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    actorUserId: string
    now: Date
  }>,
  change: 'granted' | 'revoked',
) {
  return identityMemberPropertyAccessChanged({
    organizationId: organizationId(input.organizationId),
    memberUserId: userId(input.userId),
    userId: userId(input.actorUserId),
    grantedPropertyIds: change === 'granted' ? [input.propertyId] : [],
    revokedPropertyIds: change === 'revoked' ? [input.propertyId] : [],
    occurredAt: input.now,
  })
}

export function createPolicyAdminOps(deps: PolicyAdminDeps) {
  async function grantPropertyAccessOp(
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      reason: string
      ticketRef: string
      expiresAt?: Date
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) {
      throw identityError(
        'validation_error',
        'expiresAt must be in the future for temporary access',
      )
    }
    await deps.commandStore.grantPropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      createdBy: input.actorUserId,
      expiresAt: input.expiresAt,
      now: input.now,
      buildEvent: () => propertyAccessChanged(input, 'granted'),
    })
  }

  async function revokePropertyAccessOp(
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      reason: string
      actorUserId: string
      now: Date
    }>,
  ): Promise<void> {
    await deps.commandStore.revokePropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      reason: input.reason,
      buildEvent: () => propertyAccessChanged(input, 'revoked'),
    })
    await deps.reconcileResponsibleManagerEligibility?.(
      input.organizationId,
      input.userId,
      input.actorUserId,
    )
  }

  return {
    grantPropertyAccessOp,
    revokePropertyAccessOp,
  }
}
