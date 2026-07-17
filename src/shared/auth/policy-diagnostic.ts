// Policy decision diagnostic (BQC-2.7) — read-only, content-free.
//
// Explains a decision for a specific member without exposing PII or secret
// configuration: per-layer capability/permission/scope outcomes as ids,
// booleans, and stable reason codes. Lives in shared/auth (decision-layer
// composition, not business orchestration); persistence is injected.

import '#/shared/auth/permissions' // side effect: initializes the static permission lookup
import { checkBetaCapability } from './beta-capabilities'
import {
  canForContext,
  scopeForPermission,
  type Permission,
} from '#/shared/domain/permissions'
import { capabilityForPermission } from './capability-for-permission'
import { organizationId, userId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

export type PolicyDecisionExplanation = Readonly<{
  allowed: boolean
  reason: string
  action: string
  capability: string
  checks: Readonly<{
    capability: Readonly<{ allowed: boolean; reason: string }>
    permission: Readonly<{ allowed: boolean }>
    scope: Readonly<{
      outcome: 'not_applicable' | 'organization' | 'granted' | 'missing_grant' | 'none'
    }>
  }>
}>

export type PolicyDiagnosticDeps = Readonly<{
  getMemberRole: (organizationId: string, userId: string) => Promise<string | null>
  hasActiveGrant: (input: {
    organizationId: string
    propertyId: string
    userId: string
    at: Date
  }) => Promise<boolean>
}>

function notAMemberExplanation(
  action: string,
  capability: string,
): PolicyDecisionExplanation {
  return {
    allowed: false,
    reason: 'not_a_member',
    action,
    capability,
    checks: {
      capability: { allowed: false, reason: 'not_a_member' },
      permission: { allowed: false },
      scope: { outcome: 'not_applicable' },
    },
  }
}

type ScopeOutcome = PolicyDecisionExplanation['checks']['scope']['outcome']

async function scopeOutcomeFor(
  deps: PolicyDiagnosticDeps,
  input: Readonly<{
    organizationId: string
    userId: string
    propertyId: string
    scope: 'organization' | 'assigned-properties' | 'none'
    now: Date
  }>,
): Promise<ScopeOutcome> {
  if (input.scope === 'organization') return 'organization'
  if (input.scope === 'none') return 'none'
  const granted = await deps.hasActiveGrant({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    userId: input.userId,
    at: input.now,
  })
  return granted ? 'granted' : 'missing_grant'
}

function finalReason(
  capDecision: Readonly<{ allowed: boolean; reason: string }>,
  permissionAllowed: boolean,
  scopeOutcome: ScopeOutcome,
): string {
  if (!capDecision.allowed) return capDecision.reason
  if (!permissionAllowed) return 'permission_denied'
  if (scopeOutcome === 'missing_grant' || scopeOutcome === 'none') return 'scope_denied'
  return 'allowed'
}

export function createPolicyDiagnostic(deps: PolicyDiagnosticDeps) {
  return async function explainPolicyDecision(
    input: Readonly<{
      organizationId: string
      action: Permission
      propertyId?: string
      userId: string
      now: Date
    }>,
  ): Promise<PolicyDecisionExplanation> {
    const capability = capabilityForPermission(input.action)
    const role = (await deps.getMemberRole(
      input.organizationId,
      input.userId,
    )) as Role | null
    if (!role) return notAMemberExplanation(input.action, capability)

    const ctx = {
      userId: userId(input.userId),
      organizationId: organizationId(input.organizationId),
      role,
    }
    const capDecision = checkBetaCapability(ctx, capability, input.propertyId)
    const permissionAllowed = canForContext(ctx, input.action)
    const scopeOutcome = input.propertyId
      ? await scopeOutcomeFor(deps, {
          organizationId: input.organizationId,
          userId: input.userId,
          propertyId: input.propertyId,
          scope: scopeForPermission(ctx, input.action),
          now: input.now,
        })
      : 'not_applicable'
    const reason = finalReason(capDecision, permissionAllowed, scopeOutcome)

    return {
      allowed: reason === 'allowed',
      reason,
      action: input.action,
      capability,
      checks: {
        capability: { allowed: capDecision.allowed, reason: capDecision.reason },
        permission: { allowed: permissionAllowed },
        scope: { outcome: scopeOutcome },
      },
    }
  }
}
