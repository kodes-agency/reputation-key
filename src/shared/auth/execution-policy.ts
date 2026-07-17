// ExecutionPolicy — the one fail-closed authorization decision point
// (BQC-2.4 / ADR 0033, phase BQC-2 §3).
//
// A normalized decision request (principal, action/capability, organization
// and property identifiers, execution kind, purpose, time, correlation id)
// returns an allow decision or a typed deny with a stable reason and policy
// version. Role permissions, PropertyAccessGrant, cohort/allowlist,
// suspension, capability state, consent, caches, and decision audit are
// hidden inside — callers never assemble assignedPropertyIds, branch on
// role, or order capability/authorization helpers themselves.
//
// Decision order (first deny wins):
//   1. principal/org consistency
//   2. capability (beta gate: blocked/kill-switch/suspension/allowlist)
//   3. role permission (user principals, Permission actions)
//   4. property scope (org-scope roles pass; assigned-scope requires an
//      ACTIVE GRANT — missing grant data is deny, never org-wide allow)
//   5. purpose/consent (when the request declares a purpose)
//
// Delayed/system principals (worker/consumer/schedule/operator) deny as
// `unsupported_principal` here — the BQC-2.5 contract defines their
// normalized identity and BQC-3 integrates it. Public principals get the
// global capability check only.
//
// Deps are injected at composition (identity infrastructure owns the grant
// and consent repositories); this module stays drizzle-free (boundary rule).

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import {
  checkBetaCapability,
  checkGlobalCapability,
  type Capability,
  type CapabilityDenyReason,
} from './beta-capabilities'
import {
  capabilityForPermission,
  hasPermissionCapability,
} from './capability-for-permission'
import { throwContextError } from './server-errors'

/** Bump when decision semantics change. Recorded on every decision + audit row. */
export const EXECUTION_POLICY_VERSION = 'bqc-2.4'

export type ExecutionKind =
  | 'interactive'
  | 'worker'
  | 'consumer'
  | 'schedule'
  | 'operator'
  | 'public'

export type Principal =
  | Readonly<{ kind: 'user'; ctx: AuthContext }>
  | Readonly<{ kind: 'system'; id: string }>
  | Readonly<{ kind: 'operator'; id: string }>
  | Readonly<{ kind: 'public'; id?: string }>

export type PolicyDenyReason =
  | CapabilityDenyReason
  | 'permission_denied'
  | 'scope_denied'
  | 'consent_required'
  | 'principal_org_mismatch'
  | 'unsupported_principal'
  | 'policy_unavailable'

export type ExecutionDecision = Readonly<{
  allowed: boolean
  reason: PolicyDenyReason | 'allowed'
  action: string
  policyVersion: string
}>

export type DecisionRequest = Readonly<{
  principal: Principal
  action: Permission | string
  /** Defaults from capabilityForPermission for Permission actions. */
  capability?: Capability
  organizationId?: string
  /** The actual target property — grant check applies for assigned-scope roles. */
  propertyId?: string
  executionKind: ExecutionKind
  /** Purpose/consent class; when present, an active consent is required. */
  purpose?: string
  now: Date
  correlationId?: string
}>

export type DecisionAuditEntry = Readonly<{
  actorType: string
  actorId: string | null
  organizationId: string | null
  propertyId: string | null
  action: string
  capability: string | null
  executionKind: string
  decision: string
  reason: string
  policyVersion: string
  correlationId: string | null
}>

export type ExecutionPolicyDeps = Readonly<{
  /** Identity-owned grant lookup (BQC-2.3). Throws → policy_unavailable. */
  listAccessiblePropertyIds: (
    organizationId: string,
    userId: string,
  ) => Promise<ReadonlyArray<string>>
  /** Consent reader (BQC-2.2); required only when a request declares a purpose. */
  hasActiveConsent?: (
    input: Readonly<{
      organizationId: string
      subjectType: string
      subjectId: string
      purpose: string
      at: Date
    }>,
  ) => Promise<boolean>
  /** Content-free audit sink (BQC-2.2). Best-effort: errors are reported, never thrown. */
  writeDecisionAudit?: (entry: DecisionAuditEntry) => Promise<void>
  onAuditError?: (err: unknown) => void
}>

export type ExecutionPolicy = Readonly<{
  decide(request: DecisionRequest): Promise<ExecutionDecision>
}>

function audit(
  deps: ExecutionPolicyDeps,
  request: DecisionRequest,
  capability: Capability | null,
  decision: ExecutionDecision,
): void {
  if (!deps.writeDecisionAudit) return
  const entry: DecisionAuditEntry = {
    actorType: request.principal.kind,
    actorId:
      request.principal.kind === 'user'
        ? (request.principal.ctx.userId as string)
        : 'id' in request.principal
          ? (request.principal.id ?? null)
          : null,
    organizationId:
      request.organizationId ??
      (request.principal.kind === 'user'
        ? (request.principal.ctx.organizationId as string)
        : null),
    propertyId: request.propertyId ?? null,
    action: decision.action,
    capability,
    executionKind: request.executionKind,
    decision: decision.allowed ? 'allow' : 'deny',
    reason: decision.reason,
    policyVersion: decision.policyVersion,
    correlationId: request.correlationId ?? null,
  }
  void deps.writeDecisionAudit(entry).catch((err) => deps.onAuditError?.(err))
}

function finish(
  deps: ExecutionPolicyDeps,
  request: DecisionRequest,
  capability: Capability | null | undefined,
  allowed: boolean,
  reason: ExecutionDecision['reason'],
): ExecutionDecision {
  const decision: ExecutionDecision = {
    allowed,
    reason,
    action: String(request.action),
    policyVersion: EXECUTION_POLICY_VERSION,
  }
  audit(deps, request, capability ?? null, decision)
  return decision
}

export function createExecutionPolicy(deps: ExecutionPolicyDeps): ExecutionPolicy {
  // Decision steps — first non-null deny wins (decision order in the module
  // header). Each returns a finished decision or null to continue.

  function orgConsistencyDecision(request: DecisionRequest, ctx: AuthContext) {
    return request.organizationId &&
      request.organizationId !== (ctx.organizationId as string)
      ? finish(deps, request, null, false, 'principal_org_mismatch')
      : null
  }

  function capabilityDecision(
    request: DecisionRequest,
    ctx: AuthContext,
    capability: Capability | undefined,
  ) {
    if (!capability) return null
    const capDecision = checkBetaCapability(ctx, capability, request.propertyId)
    return capDecision.allowed
      ? null
      : finish(deps, request, capability, false, capDecision.reason)
  }

  function permissionDecision(
    request: DecisionRequest,
    ctx: AuthContext,
    capability: Capability | undefined,
  ) {
    return isPermissionAction(request.action) && !canForContext(ctx, request.action)
      ? finish(deps, request, capability, false, 'permission_denied')
      : null
  }

  async function propertyScopeDecision(
    request: DecisionRequest,
    ctx: AuthContext,
    capability: Capability | undefined,
  ): Promise<ExecutionDecision | null> {
    // Org-scope roles pass; assigned-scope roles need an ACTIVE GRANT —
    // missing grant data is deny, never organization-wide allow.
    if (!request.propertyId || !isPermissionAction(request.action)) return null
    const scope = scopeForPermission(ctx, request.action)
    if (scope === 'none') return finish(deps, request, capability, false, 'scope_denied')
    if (scope !== 'assigned-properties') return null

    let ids: ReadonlyArray<string>
    try {
      ids = await deps.listAccessiblePropertyIds(
        ctx.organizationId as string,
        ctx.userId as string,
      )
    } catch {
      return finish(deps, request, capability, false, 'policy_unavailable')
    }
    return ids.includes(request.propertyId)
      ? null
      : finish(deps, request, capability, false, 'scope_denied')
  }

  async function consentDecision(
    request: DecisionRequest,
    ctx: AuthContext,
    capability: Capability | undefined,
  ): Promise<ExecutionDecision | null> {
    if (!request.purpose) return null
    const orgId = (request.organizationId ?? ctx.organizationId) as string
    const consented = deps.hasActiveConsent
      ? await deps.hasActiveConsent({
          organizationId: orgId,
          subjectType: 'organization',
          subjectId: orgId,
          purpose: request.purpose,
          at: request.now,
        })
      : false
    return consented ? null : finish(deps, request, capability, false, 'consent_required')
  }

  async function decideUser(
    request: DecisionRequest,
    ctx: AuthContext,
  ): Promise<ExecutionDecision> {
    const capability =
      request.capability ??
      (isPermissionAction(request.action)
        ? capabilityForPermission(request.action)
        : undefined)

    const deny =
      orgConsistencyDecision(request, ctx) ??
      capabilityDecision(request, ctx, capability) ??
      permissionDecision(request, ctx, capability) ??
      (await propertyScopeDecision(request, ctx, capability)) ??
      (await consentDecision(request, ctx, capability))
    return deny ?? finish(deps, request, capability, true, 'allowed')
  }

  return {
    async decide(request) {
      switch (request.principal.kind) {
        case 'user':
          return decideUser(request, request.principal.ctx)
        case 'public': {
          // Public principals get the global capability check only (no
          // role/property scope — public surface confinement is recorded in
          // the entry-point catalogue).
          if (request.capability) {
            const capDecision = checkGlobalCapability(request.capability)
            if (!capDecision.allowed) {
              return finish(deps, request, request.capability, false, capDecision.reason)
            }
          }
          return finish(deps, request, request.capability ?? null, true, 'allowed')
        }
        // BQC-2.5 defines the normalized system/operator identity; until
        // then these principals deny (fail-closed).
        case 'system':
        case 'operator':
          return finish(deps, request, null, false, 'unsupported_principal')
      }
    },
  }
}

// ── Permission vs SystemAction discrimination ────────────────────────
// Authoritative: an action is a Permission iff the permission→capability
// map covers it (the map is exhaustive — Record<Permission, Capability>).
// A prefix regex previously missed 'policy.admin', silently skipping the
// permission layer for it (BQC-2.7).

function isPermissionAction(action: string): action is Permission {
  return !action.startsWith('system:') && hasPermissionCapability(action)
}

// ── Singleton (composition-installed) + migration helper ─────────────

let _policy: ExecutionPolicy | undefined

/** Install the policy — called once from composition. */
export function initExecutionPolicy(policy: ExecutionPolicy): void {
  _policy = policy
}

/** Reset — test teardown only. */
export function resetExecutionPolicy(): void {
  _policy = undefined
}

function getExecutionPolicy(): ExecutionPolicy {
  if (!_policy) {
    throw new Error(
      '[EXECUTION POLICY] not initialized — composition must call initExecutionPolicy',
    )
  }
  return _policy
}

/**
 * Interactive migration helper (BQC-2.4): the drop-in async replacement for
 * requireAuthorized on enabled server functions. Throws a serializable
 * AuthError (403) with the stable reason on deny.
 */
export async function requireExecutionAllowed(input: {
  actor: AuthContext
  action: Permission
  capability?: Capability
  propertyId?: string
  purpose?: string
  correlationId?: string
}): Promise<void> {
  const decision = await getExecutionPolicy().decide({
    principal: { kind: 'user', ctx: input.actor },
    action: input.action,
    capability: input.capability,
    organizationId: input.actor.organizationId as string,
    propertyId: input.propertyId,
    executionKind: 'interactive',
    purpose: input.purpose,
    now: new Date(),
    correlationId: input.correlationId,
  })
  if (!decision.allowed) {
    throwContextError(
      'AuthError',
      { code: decision.reason, message: `Authorization denied: ${decision.reason}` },
      403,
    )
  }
}
