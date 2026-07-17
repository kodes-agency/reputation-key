// Delayed/system execution policy contract (BQC-2.5 / phase BQC-2 §2.5).
//
// The normalized contract workers, consumers, and schedules will authorize
// delayed execution against. BQC-2 IMPLEMENTS the contract; BQC-3 INTEGRATES
// it into job envelopes and runtime call sites (no call-site edits here).
//
// Contract rules:
//   1. Decisions are computed from CURRENT policy at execution time. A stale
//      allow decision in a queued job never overrides a current deny.
//   2. Actions with external effects (from the entry-point catalogue:
//      GBP sync/publish/import, S3 image processing, email) require a
//      fresh/strong policy read immediately before the decision.
//   3. Scope is validated from the catalogue: property-scoped actions
//      without a propertyId, or any action without an organizationId,
//      deny as missing_scope.
//   4. policyVersionAtEnqueue that differs from the running policy version
//      annotates the outcome as stale_context — an annotation only, never
//      a decision override.
//   5. Role permissions and grants do NOT apply to system principals (they
//      were checked at the interactive enqueue boundary); capability,
//      suspension, and consent are re-checked here.
//
// Every decision writes a content-free audit entry — the result JobRuntime
// consumes (BQC-3).

import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import {
  checkBetaCapability,
  type Capability,
  type CapabilityDenyReason,
} from './beta-capabilities'
import { EXECUTION_POLICY_VERSION, type DecisionAuditEntry } from './execution-policy'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

// ── Catalogue-derived contract data (single source of truth) ────────

const DELAYED_KINDS = new Set(['job', 'consumer', 'schedule'])
const DELAYED_ROWS = ENTRY_POINT_CATALOGUE.filter((r) => DELAYED_KINDS.has(r.kind))

const CAPABILITY_BY_ACTION = new Map<string, Capability | 'none'>()
for (const r of DELAYED_ROWS) {
  const existing = CAPABILITY_BY_ACTION.get(r.action)
  // Multiple rows may share an action (job + consumer + schedule); the
  // strictest declared gate wins — 'none' never overrides a real gate.
  if (existing === undefined || (existing === 'none' && r.capability !== 'none')) {
    CAPABILITY_BY_ACTION.set(r.action, r.capability)
  }
}
const PROPERTY_SCOPED_ACTIONS: Set<string> = new Set(
  DELAYED_ROWS.filter((r) => r.resourceScope === 'property').map((r) => r.action),
)
const FRESH_READ_ACTIONS: Set<string> = new Set(
  DELAYED_ROWS.filter((r) => r.externalEffect).map((r) => r.action),
)

/** The capability gate for a delayed/system action ('none' when ungated). */
export function capabilityForSystemAction(action: string): Capability | 'none' {
  return CAPABILITY_BY_ACTION.get(action) ?? 'none'
}

/** True when the action has an external effect and needs a strong policy read. */
export function requiresFreshRead(action: string): boolean {
  return FRESH_READ_ACTIONS.has(action)
}

// ── Request / decision types ─────────────────────────────────────────

export type DelayedDecisionRequest = Readonly<{
  /** Named system identity, e.g. 'worker:default', 'schedule:retention-sweep'. */
  principal: Readonly<{ kind: 'system'; id: string }>
  /** Canonical action from the entry-point catalogue. */
  action: string
  organizationId: string
  propertyId?: string
  executionKind: 'worker' | 'consumer' | 'schedule'
  /** Who enqueued the work, when relevant (user or system). */
  initiator?: Readonly<{ kind: 'user' | 'system'; id: string }>
  purpose?: string
  /** Policy version recorded at enqueue — stale-context detection only. */
  policyVersionAtEnqueue?: string
  correlationId?: string
  now: Date
}>

export type DelayedDenyReason =
  | CapabilityDenyReason
  | 'missing_scope'
  | 'consent_required'
  | 'policy_unavailable'
  | 'unknown_action'

export type DelayedDecision = Readonly<{
  /**
   * 'stale_context' annotates that policyVersionAtEnqueue differs from the
   * running policy version. It is an annotation, never a decision override —
   * `allowed`/`reason` are always computed from current policy.
   */
  outcome: 'allow' | 'deny' | 'stale_context'
  allowed: boolean
  reason: DelayedDenyReason | 'allowed'
  action: string
  policyVersion: string
  policyVersionAtEnqueue?: string
  /** Whether a strong policy read was performed for this decision. */
  freshRead: boolean
}>

export type DelayedPolicyDeps = Readonly<{
  /** Version-gated strong read (container.refreshPolicyStore). */
  refreshPolicy: () => Promise<void>
  hasActiveConsent?: (
    input: Readonly<{
      organizationId: string
      subjectType: string
      subjectId: string
      purpose: string
      at: Date
    }>,
  ) => Promise<boolean>
  writeDecisionAudit?: (entry: DecisionAuditEntry) => Promise<void>
  onAuditError?: (err: unknown) => void
}>

export type DelayedExecutionPolicy = Readonly<{
  decide(request: DelayedDecisionRequest): Promise<DelayedDecision>
}>

export function createDelayedExecutionPolicy(
  deps: DelayedPolicyDeps,
): DelayedExecutionPolicy {
  function finish(
    request: DelayedDecisionRequest,
    capability: Capability | 'none',
    allowed: boolean,
    reason: DelayedDecision['reason'],
    freshRead: boolean,
  ): DelayedDecision {
    const stale =
      request.policyVersionAtEnqueue !== undefined &&
      request.policyVersionAtEnqueue !== EXECUTION_POLICY_VERSION
    const decision: DelayedDecision = {
      outcome: allowed ? (stale ? 'stale_context' : 'allow') : 'deny',
      allowed,
      reason,
      action: request.action,
      policyVersion: EXECUTION_POLICY_VERSION,
      policyVersionAtEnqueue: request.policyVersionAtEnqueue,
      freshRead,
    }
    if (deps.writeDecisionAudit) {
      void deps
        .writeDecisionAudit({
          actorType: 'system',
          actorId: request.principal.id,
          organizationId: request.organizationId || null,
          propertyId: request.propertyId ?? null,
          action: request.action,
          capability: capability === 'none' ? null : capability,
          executionKind: request.executionKind,
          decision: allowed ? 'allow' : 'deny',
          reason,
          policyVersion: EXECUTION_POLICY_VERSION,
          correlationId: request.correlationId ?? null,
        })
        .catch((err) => deps.onAuditError?.(err))
    }
    return decision
  }

  return {
    async decide(request) {
      const freshRead = requiresFreshRead(request.action)

      // Unknown actions fail closed — the catalogue is the contract surface.
      if (!CAPABILITY_BY_ACTION.has(request.action)) {
        return finish(request, 'none', false, 'unknown_action', freshRead)
      }

      // Rule 2: strong read for external-effect actions, before deciding.
      if (freshRead) {
        try {
          await deps.refreshPolicy()
        } catch {
          return finish(request, 'none', false, 'policy_unavailable', true)
        }
      }

      // Rule 3: catalogue-driven scope validation.
      if (!request.organizationId) {
        return finish(request, 'none', false, 'missing_scope', freshRead)
      }
      if (PROPERTY_SCOPED_ACTIONS.has(request.action) && !request.propertyId) {
        return finish(request, 'none', false, 'missing_scope', freshRead)
      }

      // Rule 5: capability + suspension re-check against CURRENT policy.
      const capability = capabilityForSystemAction(request.action)
      if (capability !== 'none') {
        const systemCtx: AuthContext = {
          userId: userId(request.principal.id),
          organizationId: organizationId(request.organizationId),
          role: 'AccountAdmin',
        }
        const capDecision = checkBetaCapability(systemCtx, capability, request.propertyId)
        if (!capDecision.allowed) {
          return finish(request, capability, false, capDecision.reason, freshRead)
        }
      }

      // Purpose/consent re-check (org-level subject, as interactive).
      if (request.purpose) {
        const consented = deps.hasActiveConsent
          ? await deps.hasActiveConsent({
              organizationId: request.organizationId,
              subjectType: 'organization',
              subjectId: request.organizationId,
              purpose: request.purpose,
              at: request.now,
            })
          : false
        if (!consented) {
          return finish(request, capability, false, 'consent_required', freshRead)
        }
      }

      return finish(request, capability, true, 'allowed', freshRead)
    },
  }
}

// ── Singleton (composition-installed) ────────────────────────────────

let _delayed: DelayedExecutionPolicy | undefined

/** Install the delayed policy — called once from composition. */
export function initDelayedExecutionPolicy(policy: DelayedExecutionPolicy): void {
  _delayed = policy
}

/** Reset — test teardown only. */
export function resetDelayedExecutionPolicy(): void {
  _delayed = undefined
}

/** The installed delayed policy. Throws when composition has not installed it. */
export function getDelayedExecutionPolicy(): DelayedExecutionPolicy {
  if (!_delayed) {
    throw new Error(
      '[DELAYED EXECUTION POLICY] not initialized — composition must call initDelayedExecutionPolicy',
    )
  }
  return _delayed
}
