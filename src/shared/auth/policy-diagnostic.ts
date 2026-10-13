// Policy decision diagnostic (BQC-2.7) — read-only, content-free.
//
// Explains a decision for a specific member without exposing PII or secret
// configuration: per-layer capability/permission/scope outcomes as ids,
// booleans, and stable reason codes. Lives in shared/auth (decision-layer
// composition, not business orchestration); persistence is injected.
//
// The membership read returns the role as Better Auth stores it (`owner`,
// `admin`, `member`). The permission table is keyed by domain role, so the
// token is mapped here exactly as tenant resolution maps it: a token that is
// not an active beta manager role resolves no tenant, and the diagnostic says
// so instead of looking it up.

import '#/shared/auth/permissions' // side effect: initializes the static permission lookup
import { checkBetaCapability } from './beta-capabilities'
import {
  canForContext,
  scopeForPermission,
  type Permission,
} from '#/shared/domain/permissions'
import { capabilityForPermission } from './capability-for-permission'
import { organizationId, userId } from '#/shared/domain/ids'
import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'
import { toDomainRole, type Role } from '#/shared/domain/roles'

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
  /** The member's role token as Better Auth stores it, or null for no membership. */
  getMemberRole: (organizationId: string, userId: string) => Promise<string | null>
  hasActiveGrant: (input: {
    organizationId: string
    propertyId: string
    userId: string
    at: Date
  }) => Promise<boolean>
}>

/** Why no layer was asked: the user resolves no tenant in this Organization. */
type NoTenantReason = 'not_a_member' | 'beta_role_inactive'

function noTenantExplanation(
  reason: NoTenantReason,
  action: string,
  capability: string,
): PolicyDecisionExplanation {
  return {
    allowed: false,
    reason,
    action,
    capability,
    checks: {
      capability: { allowed: false, reason },
      permission: { allowed: false },
      scope: { outcome: 'not_applicable' },
    },
  }
}

/**
 * The domain role tenant resolution gives a stored role token, or null when it
 * gives none: the retained `member` role, a custom role and a multi-role
 * token are refused before any permission is read.
 */
function activeDomainRole(roleToken: string): Role | null {
  return isBetaInteractiveMemberRoleToken(roleToken) ? toDomainRole(roleToken) : null
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
    const roleToken = await deps.getMemberRole(input.organizationId, input.userId)
    if (!roleToken) return noTenantExplanation('not_a_member', input.action, capability)
    const role = activeDomainRole(roleToken)
    if (!role) {
      return noTenantExplanation('beta_role_inactive', input.action, capability)
    }

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
