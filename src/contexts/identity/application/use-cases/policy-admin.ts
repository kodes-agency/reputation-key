// Administration for the surviving PropertyAccessGrant authority.

import type { PolicyAdminExplanation } from '../ports/property-access-grant.port'
import type { PolicyAdminCommandStore } from '../ports/policy-admin-command-store.port'
import type { Permission } from '#/shared/domain/permissions'

export type PolicyAdminDeps = Readonly<{
  explainPolicyDecision: (input: {
    organizationId: string
    action: Permission
    propertyId?: string
    userId: string
    now: Date
  }) => Promise<PolicyAdminExplanation>
  commandStore: PolicyAdminCommandStore
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

function requireReason(reason: string): void {
  if (reason.trim().length < 3) throw new Error('reason is required (min 3 chars)')
}

function requireTicket(ticketRef: string): void {
  if (ticketRef.trim().length < 2) throw new Error('ticket/reference is required')
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
    requireReason(input.reason)
    requireTicket(input.ticketRef)
    if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) {
      throw new Error('expiresAt must be in the future for temporary access')
    }
    await deps.commandStore.grantPropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      source: 'operator',
      createdBy: input.actorUserId,
      expiresAt: input.expiresAt,
    })
  }

  async function revokePropertyAccessOp(
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      reason: string
      actorUserId: string
    }>,
  ): Promise<void> {
    requireReason(input.reason)
    await deps.commandStore.revokePropertyAccess({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      userId: input.userId,
      reason: input.reason,
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
    explainPolicyDecision: deps.explainPolicyDecision,
  }
}
