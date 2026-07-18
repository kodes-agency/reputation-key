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
import type {
  RoutingBlockedReason,
  RoutingDecision,
} from '#/shared/routing/processing-router'

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

// ── Property region diagnostic (BQC-4.4) ─────────────────────────────
//
// Operator-facing region state for one property: the persisted routing
// facts, the router's processable/blocked decision, and the current cell +
// LOGICAL provider reference (CELL_TARGETS — never a URL). Content-free by
// construction (ADR 0048 "control-plane metadata"). The ProcessingRouter
// stays the ONE routing decision model — this diagnostic reports what the
// router decides; it never re-derives region policy itself.

/** The region facts persisted on the property (migration 0006). */
export type PropertyRegionRecord = Readonly<{
  processingRegion: string | null
  processingRegionSource: string | null
  routingPolicyVersion: number
}>

export type PropertyRegionDiagnostic = Readonly<{
  propertyId: string
  processingRegion: string | null
  processingRegionSource: string | null
  /** Null when the property is missing (or outside the caller's org). */
  routingPolicyVersion: number | null
  processable: boolean
  /** Router blocked reason; null when processable. */
  blockedReason: RoutingBlockedReason | null
  /** The deployment's processing cell (PROCESSING_CELL). */
  cell: string
  /** The cell's logical provider reference (e.g. 'gbp-default') — never a URL. */
  providerRef: string | null
}>

export type RegionDiagnosticDeps = Readonly<{
  /**
   * Org-scoped lookup of the property's persisted region facts; null when
   * the property is missing OR outside the caller's organization (least
   * privilege — cross-org properties are indistinguishable from missing).
   */
  loadPropertyRegion: (
    organizationId: string,
    propertyId: string,
  ) => Promise<PropertyRegionRecord | null>
  /** The router's fresh routing decision (bound: router.resolve). */
  resolveRouting: (propertyId: string) => Promise<RoutingDecision>
  /** The deployment's processing cell (env PROCESSING_CELL). */
  cell: string
  /** providerRefForCell(cell) — the cell's logical provider reference. */
  providerRef: string | null
}>

export function createRegionDiagnostic(deps: RegionDiagnosticDeps) {
  return async function getRegionDiagnostic(
    input: Readonly<{ organizationId: string; propertyId: string }>,
  ): Promise<PropertyRegionDiagnostic> {
    const record = await deps.loadPropertyRegion(input.organizationId, input.propertyId)
    if (!record) {
      return {
        propertyId: input.propertyId,
        processingRegion: null,
        processingRegionSource: null,
        routingPolicyVersion: null,
        processable: false,
        blockedReason: 'property_missing',
        cell: deps.cell,
        providerRef: deps.providerRef,
      }
    }
    const decision = await deps.resolveRouting(input.propertyId)
    return {
      propertyId: input.propertyId,
      processingRegion: record.processingRegion,
      processingRegionSource: record.processingRegionSource,
      routingPolicyVersion: record.routingPolicyVersion,
      processable: decision.kind === 'target',
      blockedReason: decision.kind === 'blocked' ? decision.reason : null,
      cell: deps.cell,
      providerRef: deps.providerRef,
    }
  }
}
