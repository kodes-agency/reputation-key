// Delayed/system execution policy contract (BQC-2.5 / phase BQC-2 §2.5).
//
// The normalized contract workers, consumers, and schedules will authorize
// delayed execution against. BQC-2 IMPLEMENTS the contract; BQC-3 INTEGRATES
// it into job envelopes and runtime call sites (no call-site edits here).
//
// Contract rules:
//   1. Decisions are computed from CURRENT policy at execution time. A stale
//      allow decision in a queued job never overrides a current deny.
//   2. Scope is validated from the catalogue: a property-scoped entry point
//      without a propertyId, or any action without an organizationId,
//      denies as missing_scope. The scope is the resolved entry-point row's,
//      never borrowed from another row that shares the action.
//   3. Role permissions and grants do NOT apply to system principals (they
//      were checked at the interactive enqueue boundary); capability
//      and suspension are re-checked here.

import {
  ENTRY_POINT_CATALOGUE,
  type ResourceScope,
} from '#/shared/governance/entry-point-catalogue'
import {
  checkBetaCapability,
  type Capability,
  type CapabilityDenyReason,
} from './beta-capabilities'
import { EXECUTION_POLICY_VERSION } from './execution-policy'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

// ── Catalogue-derived contract data (single source of truth) ────────

const CAPABILITY_BY_ACTION = new Map<string, Capability | 'none'>()
for (const r of ENTRY_POINT_CATALOGUE) {
  const existing = CAPABILITY_BY_ACTION.get(r.action)
  // Multiple rows may share an action (job + consumer + schedule); the
  // strictest declared gate wins — 'none' never overrides a real gate.
  if (existing === undefined || (existing === 'none' && r.capability !== 'none')) {
    CAPABILITY_BY_ACTION.set(r.action, r.capability)
  }
}
// Every row of one action declares the same scope (pinned by the catalogue
// guard in system-execution-policy.test), so an authorization that names only
// an action still reads the scope its entry points declare.
const SCOPE_BY_ACTION = new Map<string, ResourceScope>()
for (const r of ENTRY_POINT_CATALOGUE) {
  if (!SCOPE_BY_ACTION.has(r.action)) SCOPE_BY_ACTION.set(r.action, r.resourceScope)
}

/** The capability gate for a delayed/system action ('none' when ungated). */
export function capabilityForSystemAction(action: string): Capability | 'none' {
  return CAPABILITY_BY_ACTION.get(action) ?? 'none'
}

// ── Request / decision types ─────────────────────────────────────────

export type DelayedDecisionRequest = Readonly<{
  /** Named system identity, e.g. 'worker:default', 'schedule:retention-sweep'. */
  principal: Readonly<{ kind: 'system'; id: string }>
  /** Canonical action from the entry-point catalogue. */
  action: string
  /**
   * Scope of the entry-point row being executed. The gate passes the row it
   * resolved; a request that names only an action gets that action's scope.
   */
  resourceScope?: ResourceScope
  organizationId: string
  propertyId?: string
  /** Capability recorded by the producer; must match the catalogue when present. */
  capabilityAtEnqueue?: Capability | 'none'
  executionKind: 'worker' | 'consumer' | 'schedule'
  /** Who enqueued the work, when relevant (user or system). */
  initiator?: Readonly<{ kind: 'user' | 'system'; id: string }>
  correlationId?: string
  now: Date
}>

export type DelayedDenyReason =
  CapabilityDenyReason | 'missing_scope' | 'capability_mismatch' | 'unknown_action'

export type DelayedDecision = Readonly<{
  allowed: boolean
  reason: DelayedDenyReason | 'allowed'
  action: string
  policyVersion: string
}>

export type DelayedExecutionPolicy = Readonly<{
  decide(request: DelayedDecisionRequest): Promise<DelayedDecision>
}>

export function createDelayedExecutionPolicy(): DelayedExecutionPolicy {
  function finish(
    request: DelayedDecisionRequest,
    allowed: boolean,
    reason: DelayedDecision['reason'],
  ): DelayedDecision {
    return {
      allowed,
      reason,
      action: request.action,
      policyVersion: EXECUTION_POLICY_VERSION,
    }
  }

  return {
    async decide(request) {
      // Unknown actions fail closed — the catalogue is the contract surface.
      if (!CAPABILITY_BY_ACTION.has(request.action)) {
        return finish(request, false, 'unknown_action')
      }

      // Rule 2: catalogue-driven scope validation.
      const scope = request.resourceScope ?? SCOPE_BY_ACTION.get(request.action)
      if (!request.organizationId) {
        return finish(request, false, 'missing_scope')
      }
      if (scope === 'property' && !request.propertyId) {
        return finish(request, false, 'missing_scope')
      }

      const capability = capabilityForSystemAction(request.action)
      if (
        request.capabilityAtEnqueue !== undefined &&
        request.capabilityAtEnqueue !== capability
      ) {
        return finish(request, false, 'capability_mismatch')
      }

      // A tenant-cross schedule is only the enumeration boundary. It may
      // inspect identifiers across tenants, but every candidate must be
      // authorized again with its real organization/property before work
      // (createScheduledScopeAuthorizer). Nothing below this line runs for
      // the firing, so a handler that skips that step ignores the switches
      // and suspension:
      // architecture/tenant-cross-schedule-authorization.test names how every
      // capability-gated tenant-cross schedule decides its candidates.
      // Worker/consumer invocations never receive this exception.
      if (
        request.executionKind === 'schedule' &&
        request.organizationId === 'tenant-cross' &&
        scope === 'tenant_cross'
      ) {
        return finish(request, true, 'allowed')
      }

      // Rule 3: capability + suspension re-check against CURRENT policy.
      if (capability !== 'none') {
        const systemCtx: AuthContext = {
          userId: userId(request.principal.id),
          organizationId: organizationId(request.organizationId),
          role: 'AccountAdmin',
        }
        const capDecision = checkBetaCapability(systemCtx, capability)
        if (!capDecision.allowed) {
          return finish(request, false, capDecision.reason)
        }
      }

      return finish(request, true, 'allowed')
    },
  }
}

// ── Singleton (composition-installed) ────────────────────────────────

let _delayed: DelayedExecutionPolicy | undefined

/**
 * Install the delayed policy.
 *
 * ARC-03-T8: production code installs through the single owner
 * (shared/auth/process-policy-binding.bindProcessPolicies) so a second
 * container cannot silently re-install it. Tests still install directly.
 */
export function initDelayedExecutionPolicy(policy: DelayedExecutionPolicy): void {
  _delayed = policy
}

/** Reset — test teardown only. */
export function resetDelayedExecutionPolicy(): void {
  _delayed = undefined
  _ensureDelayedPolicy = undefined
}

/**
 * Lazy initializer fired when the delayed policy is read before composition
 * installed it (fresh-process first gated emit/dispatch). The composition
 * root registers `getContainer`; tests that don't register keep the
 * historical not-initialized throw. Same cold-boot race as the interactive
 * ExecutionPolicy (see execution-policy.ts).
 */
let _ensureDelayedPolicy: (() => void) | undefined

/**
 * Register the lazy initializer.
 *
 * ARC-03-T8: registered explicitly by the web entry (src/start.ts) through
 * registerProcessPolicyColdBoot, not as a composition import-time side effect.
 */
export function registerDelayedExecutionPolicyInit(ensure: () => void): void {
  _ensureDelayedPolicy = ensure
}

/** The installed delayed policy. Throws when composition has not installed it. */
export function getDelayedExecutionPolicy(): DelayedExecutionPolicy {
  if (!_delayed) {
    _ensureDelayedPolicy?.()
  }
  if (!_delayed) {
    throw new Error(
      '[DELAYED EXECUTION POLICY] not initialized — composition must call initDelayedExecutionPolicy',
    )
  }
  return _delayed
}
