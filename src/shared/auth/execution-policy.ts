// ExecutionPolicy — the one fail-closed authorization decision point
// (BQC-2.4 / ADR 0033, phase BQC-2 §3).
//
// A normalized decision request (principal, action/capability, organization
// and property identifiers, execution kind, purpose, time, correlation id)
// returns an allow decision or a typed deny with a stable reason and policy
// version. Role permissions, PropertyAccessGrant, cohort/allowlist,
// suspension, capability state, consent, and caches are hidden inside —
// callers never branch on role or order capability/authorization helpers.
//
// Decision order (first deny wins):
//   1. principal/org consistency
//   2. capability (beta gate: blocked/kill-switch/suspension/allowlist)
//   3. role permission (user principals, Permission actions)
//   4. property scope (org-scope roles pass; assigned-scope requires an
//      ACTIVE GRANT — missing grant data is deny, never org-wide allow)
//   5. purpose/consent (when the request declares a purpose)
//
// Delayed/system principals (worker/consumer/schedule) deny as
// `unsupported_principal` here — the BQC-2.5 contract defines their
// normalized identity and BQC-3 integrates it (system-execution-policy.ts).
// Public principals get the global capability check only.
//
// BQC-7.5: operator principals (scripts/ops/* commands) are SUPPORTED with
// their own branch — the named-operator identity requirement comes FIRST
// (OPS_OPERATOR_IDENTITIES allowlist, `operator_not_registered` when the id
// is not registered or no allowlist is bound), then the same capability/
// suspension store machinery as the system path (when the command declares
// a capability), then purpose/consent when declared. Operators hold no
// role/grants, so the permission and property-scope layers do not apply;
// the command's org/property scope is carried explicitly on the request.
//
// Deps are injected at composition (identity infrastructure owns the grant
// and consent repositories); this module stays drizzle-free (boundary rule).

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { organizationId, userId } from '#/shared/domain/ids'
import {
  checkBetaCapability,
  checkGlobalCapability,
  checkScopedCapability,
  type Capability,
  type CapabilityDenyReason,
} from './beta-capabilities'
import {
  capabilityForPermission,
  hasPermissionCapability,
} from './capability-for-permission'
import { throwContextError } from './server-errors'

/** Bump when decision semantics change. */
export const EXECUTION_POLICY_VERSION = 'beta-local-2'

export type ExecutionKind =
  'interactive' | 'worker' | 'consumer' | 'schedule' | 'operator' | 'public'

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
  | 'operator_not_registered'
  | 'policy_unavailable'

export type ExecutionDecision = Readonly<{
  allowed: boolean
  reason: PolicyDenyReason | 'allowed'
  action: string
  policyVersion: string
}>
export type PublicConsent = 'analytics' | 'response' | 'freeText' | 'contact' | 'media'

export type MerchantAiConsentFence = Readonly<{
  authorizationLineageId: string
  capabilityEpoch: number
  authorizedSourceEpoch: number
  stateVersion: number
  noticeDigest: string
  runtimeProfileVersion: string
}>

export type PublicConsentAssertions = Readonly<Record<PublicConsent, boolean>>
export type ConsentSelector = Readonly<{
  subjectType: 'organization' | 'property' | 'user'
  subjectId: string
  purpose: string
  expectedFence?: MerchantAiConsentFence
}>

const MERCHANT_AI_CONSENT_PURPOSES: ReadonlySet<string> = new Set([
  'ai.analyze',
  'ai.generate_reply',
  'ai.detect_trends',
])

export function isConsentSelectorBoundToScope(
  consent: ConsentSelector,
  scope: Readonly<{
    organizationId: string
    propertyId?: string
    userId?: string
  }>,
): boolean {
  if (MERCHANT_AI_CONSENT_PURPOSES.has(consent.purpose)) {
    const fence = consent.expectedFence
    return (
      consent.subjectType === 'property' &&
      scope.propertyId !== undefined &&
      consent.subjectId === scope.propertyId &&
      fence !== undefined &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        fence.authorizationLineageId,
      ) &&
      Number.isSafeInteger(fence.capabilityEpoch) &&
      fence.capabilityEpoch >= 1 &&
      Number.isSafeInteger(fence.authorizedSourceEpoch) &&
      // 0-based source epoch (drizzle/0060); capabilityEpoch and stateVersion
      // above are genuinely 1-based.
      fence.authorizedSourceEpoch >= 0 &&
      Number.isSafeInteger(fence.stateVersion) &&
      fence.stateVersion >= 1 &&
      /^[0-9a-f]{64}$/.test(fence.noticeDigest) &&
      fence.runtimeProfileVersion.length > 0
    )
  }
  return (
    (consent.subjectType === 'organization' &&
      consent.subjectId === scope.organizationId) ||
    (consent.subjectType === 'property' &&
      scope.propertyId !== undefined &&
      consent.subjectId === scope.propertyId) ||
    (consent.subjectType === 'user' &&
      scope.userId !== undefined &&
      consent.subjectId === scope.userId)
  )
}

export type DecisionRequest = Readonly<{
  principal: Principal
  action: Permission | string
  /** Defaults from capabilityForPermission for Permission actions. */
  capability?: Capability
  organizationId?: string
  /** The actual target property — grant check applies for assigned-scope roles. */
  propertyId?: string
  executionKind: ExecutionKind
  /** Explicit consent subject; when present, current matching consent is required. */
  consent?: ConsentSelector
  /** Public requests carry pre-resolved, request-bound consent assertions. */
  consentAssertions?: PublicConsentAssertions
  /** Every named assertion must be true; content/redirect reads omit this. */
  requiredPublicConsents?: ReadonlyArray<PublicConsent>
  /** BQC-7.5: operator-supplied justification for the evaluated command. */
  reason?: string
  now: Date
  correlationId?: string
}>

export type PublicDecisionRequest = Readonly<{
  action: string
  capability?: Capability
  organizationId?: string
  propertyId?: string
  purpose?: string
  consentAssertions?: PublicConsentAssertions
  requiredPublicConsents?: ReadonlyArray<PublicConsent>
  now: Date
  correlationId?: string
}>


export type ExecutionPolicyDeps = Readonly<{
  /** Identity-owned grant lookup (BQC-2.3). Throws → policy_unavailable. */
  listAccessiblePropertyIds: (
    organizationId: string,
    userId: string,
  ) => Promise<ReadonlyArray<string>>
  /** Consent reader; required only when a request declares an explicit selector. */
  hasActiveConsent?: (
    input: Readonly<
      ConsentSelector & {
        organizationId: string
        at: Date
      }
    >,
  ) => Promise<boolean>
  /**
   * BQC-7.5: named-operator allowlist predicate (bound from
   * OPS_OPERATOR_IDENTITIES at composition). ABSENT = fail closed: every
   * operator principal denies as operator_not_registered.
   */
  isRegisteredOperator?: (operatorId: string) => boolean
}>

export type ExecutionPolicy = Readonly<{
  decide(request: DecisionRequest): Promise<ExecutionDecision>
}>


function finish(
  request: DecisionRequest,
  allowed: boolean,
  reason: ExecutionDecision['reason'],
): ExecutionDecision {
  return {
    allowed,
    reason,
    action: String(request.action),
    policyVersion: EXECUTION_POLICY_VERSION,
  }
}

export function createExecutionPolicy(deps: ExecutionPolicyDeps): ExecutionPolicy {
  // Decision steps — first non-null deny wins (decision order in the module
  // header). Each returns a finished decision or null to continue.

  function orgConsistencyDecision(request: DecisionRequest, ctx: AuthContext) {
    return request.organizationId &&
      request.organizationId !== (ctx.organizationId as string)
      ? finish(request, false, 'principal_org_mismatch')
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
      : finish(request, false, capDecision.reason)
  }

  function permissionDecision(request: DecisionRequest, ctx: AuthContext) {
    return isPermissionAction(request.action) && !canForContext(ctx, request.action)
      ? finish(request, false, 'permission_denied')
      : null
  }

  async function propertyScopeDecision(
    request: DecisionRequest,
    ctx: AuthContext,
  ): Promise<ExecutionDecision | null> {
    // Org-scope roles pass; assigned-scope roles need an ACTIVE GRANT —
    // missing grant data is deny, never organization-wide allow.
    if (!request.propertyId || !isPermissionAction(request.action)) return null
    const scope = scopeForPermission(ctx, request.action)
    if (scope === 'none')
      return finish(request, false, 'scope_denied')
    if (scope !== 'assigned-properties') return null

    let ids: ReadonlyArray<string>
    try {
      ids = await deps.listAccessiblePropertyIds(
        ctx.organizationId as string,
        ctx.userId as string,
      )
    } catch {
      return finish(request, false, 'policy_unavailable')
    }
    return ids.includes(request.propertyId)
      ? null
      : finish(request, false, 'scope_denied')
  }

  async function consentDecision(
    request: DecisionRequest,
    ctx: AuthContext,
  ): Promise<ExecutionDecision | null> {
    if (!request.consent) return null
    const organizationId = (request.organizationId ?? ctx.organizationId) as string
    const subjectMatchesRequest = isConsentSelectorBoundToScope(request.consent, {
      organizationId,
      propertyId: request.propertyId,
      userId: ctx.userId as string,
    })
    const consented =
      subjectMatchesRequest && deps.hasActiveConsent
        ? await deps.hasActiveConsent({
            organizationId,
            ...request.consent,
            at: request.now,
          })
        : false
    return consented
      ? null
      : finish(request, false, 'consent_required')
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
      permissionDecision(request, ctx) ??
      (await propertyScopeDecision(request, ctx)) ??
      (await consentDecision(request, ctx))
    return deny ?? finish(request, true, 'allowed')
  }

  // BQC-7.5 — operator branch (scripts/ops/* commands). Decision order:
  //   1. kind match: an operator principal only executes as 'operator'
  //      (anything else = unsupported_principal);
  //   2. named-operator identity: the id MUST be registered
  //      (OPS_OPERATOR_IDENTITIES via deps.isRegisteredOperator) —
  //      unregistered denies BEFORE any capability evaluation;
  //   3. capability/suspension gate (only when the command declares a
  //      capability — the same store machinery as the system path:
  //      org-scoped requests get the org+property suspension and allowlist
  //      checks via a synthetic permissionless admin context; global-scope
  //      requests get the global gate). Operators hold no role/grants, so
  //      the permission and property-scope layers never apply;
  //   4. purpose/consent, when the request declares one.

  function operatorCapabilityDecision(
    request: DecisionRequest,
    operatorId: string,
  ): ExecutionDecision | null {
    const capability = request.capability
    if (!capability) return null
    if (!request.organizationId) {
      const globalDecision = checkGlobalCapability(capability)
      return globalDecision.allowed
        ? null
        : finish(request, false, globalDecision.reason)
    }
    // Synthetic permissionless admin context: the capability/suspension
    // machinery needs an org carrier — operators hold no role or grants, so
    // the permission and property-scope layers never apply to them.
    const operatorCtx: AuthContext = {
      userId: userId(operatorId),
      organizationId: organizationId(request.organizationId),
      role: 'AccountAdmin',
    }
    const capDecision = checkBetaCapability(operatorCtx, capability, request.propertyId)
    return capDecision.allowed
      ? null
      : finish(request, false, capDecision.reason)
  }

  async function operatorConsentDecision(
    request: DecisionRequest,
  ): Promise<ExecutionDecision | null> {
    if (!request.consent) return null
    const organizationId = request.organizationId
    const subjectMatchesRequest =
      organizationId !== undefined &&
      isConsentSelectorBoundToScope(request.consent, {
        organizationId,
        propertyId: request.propertyId,
      })
    const consented =
      subjectMatchesRequest && deps.hasActiveConsent
        ? await deps.hasActiveConsent({
            organizationId,
            ...request.consent,
            at: request.now,
          })
        : false
    return consented
      ? null
      : finish(request, false, 'consent_required')
  }

  async function decideOperator(
    request: DecisionRequest,
    operatorId: string,
  ): Promise<ExecutionDecision> {
    if (request.executionKind !== 'operator') {
      return finish(request, false, 'unsupported_principal')
    }
    if (!deps.isRegisteredOperator?.(operatorId)) {
      return finish(request, false, 'operator_not_registered')
    }
    const deny =
      operatorCapabilityDecision(request, operatorId) ??
      (await operatorConsentDecision(request))
    return (
      deny ??
      finish(request, true, 'allowed')
    )
  }

  async function decidePublic(request: DecisionRequest): Promise<ExecutionDecision> {
    if (request.executionKind !== 'public') {
      return finish(request, false, 'unsupported_principal')
    }
    if (request.capability) {
      const capDecision = request.organizationId
        ? checkScopedCapability(
            {
              organizationId: request.organizationId,
              ...(request.propertyId ? { propertyId: request.propertyId } : {}),
            },
            request.capability,
          )
        : checkGlobalCapability(request.capability)
      if (!capDecision.allowed) {
        return finish(request, false, capDecision.reason)
      }
    }
    if (
      request.requiredPublicConsents?.some(
        (consent) => request.consentAssertions?.[consent] !== true,
      )
    ) {
      return finish(request, false, 'consent_required')
    }
    return finish(request, true, 'allowed')
  }

  return {
    async decide(request) {
      switch (request.principal.kind) {
        case 'user':
          return decideUser(request, request.principal.ctx)
        case 'public':
          return decidePublic(request)
        // BQC-7.5: operator commands (named operator + explicit scope).
        case 'operator':
          return decideOperator(request, request.principal.id)
        // BQC-2.5 defines the normalized system identity (the delayed
        // contract in system-execution-policy.ts); here it stays fail-closed.
        case 'system':
          return finish(request, false, 'unsupported_principal')
      }
    },
  }
}

/**
 * BQC-7.5: parse the named-operator allowlist (OPS_OPERATOR_IDENTITIES —
 * comma-separated operator ids, e.g. emails). Empty/absent = no registered
 * operators (every operator command denies operator_not_registered).
 */
export function parseOperatorIdentities(
  env: Readonly<{ OPS_OPERATOR_IDENTITIES?: string }>,
): ReadonlySet<string> {
  return new Set(
    (env.OPS_OPERATOR_IDENTITIES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
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

/**
 * Install the policy.
 *
 * ARC-03-T8: production code calls this through ONE owner —
 * shared/auth/process-policy-binding.bindProcessPolicies — so a second
 * container in the same process cannot silently re-point the singleton at its
 * own policy dependencies. Tests still install directly.
 */
export function initExecutionPolicy(policy: ExecutionPolicy): void {
  _policy = policy
}

/** Reset — test teardown only. */
export function resetExecutionPolicy(): void {
  _policy = undefined
  _ensurePolicy = undefined
}

/**
 * Lazy initializer fired when the policy is read before composition installed
 * it — the first policy-gated call in a FRESH process. The composition root
 * registers `getContainer` (which builds the container and installs the
 * policy synchronously); tests that don't register anything keep the
 * historical not-initialized throw.
 *
 * Why: getContainer() is a lazy singleton, but policy checks (e.g.
 * organizations.query.ts requireExecutionAllowed) run BEFORE any
 * getContainer() call in a fresh process — so the first gated request after
 * every cold boot failed with "[EXECUTION POLICY] not initialized" until some
 * other code happened to build the container first.
 */
let _ensurePolicy: (() => void) | undefined

/**
 * Register the lazy initializer.
 *
 * ARC-03-T8: no longer a composition module-load side effect. The web entry
 * (src/start.ts) registers it explicitly through
 * shared/auth/process-policy-binding.registerProcessPolicyColdBoot.
 */
export function registerExecutionPolicyInit(ensure: () => void): void {
  _ensurePolicy = ensure
}

/**
 * The installed policy. Throws when composition has not installed it.
 * Exported for the BQC-7.5 operator-command harness (scripts/ops boot the
 * policy store directly, then evaluate through the installed singleton).
 */
export function getExecutionPolicy(): ExecutionPolicy {
  if (!_policy) {
    _ensurePolicy?.()
  }
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
  consent?: ConsentSelector
  correlationId?: string
}): Promise<void> {
  const decision = await getExecutionPolicy().decide({
    principal: { kind: 'user', ctx: input.actor },
    action: input.action,
    capability: input.capability,
    organizationId: input.actor.organizationId as string,
    propertyId: input.propertyId,
    executionKind: 'interactive',
    consent: input.consent,
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

export async function decidePublicExecution(
  input: PublicDecisionRequest,
): Promise<ExecutionDecision> {
  return getExecutionPolicy().decide({
    ...input,
    principal: { kind: 'public' },
    executionKind: 'public',
  })
}
