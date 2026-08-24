// BetaCapabilities — server-side feature-gate policy for controlled beta (B0.5).
//
// Capabilities are distinct from permissions. Permissions are role-based
// ("can user X do action Y in their org?"). Capabilities are feature-gate-based
// ("is feature Y enabled for this org/property in this environment?").
//
// A server function should check capability FIRST, then permission:
//   1. checkBetaCapability(ctx, 'property.publish_reply') — is the feature on?
//   2. canForContext(ctx, 'property.publish_reply') — does the role allow it?
//
// Default posture: core capabilities on, non-core off. Unknown capabilities
// and missing policy fail closed for mutations and external effects.
//
// BQC-0.3: tests should inject a policy store via initCapabilityPolicyStore
// (dependency-injected adapters). The BETA_E2E_GLOBAL_CAPABILITIES environment
// backdoor exists only for browser E2E, where the app runs as a separate
// process; it is guarded at boot by capability-boot-guard.ts.
//
// BQC-7.8: RESTORE_MODE=isolated (restore drills) overrides every installed
// or configured store at the getStore() seam below — all capabilities deny
// fail-closed while the mode is set.

import type { AuthContext } from '#/shared/domain/auth-context'
import { isRestoreIsolated } from '#/shared/config/restore-mode'

/**
 * Capability-policy version. Bump when capability vocabulary or posture changes.
 * Recorded in the boot and release manifests.
 */
export const CAPABILITY_POLICY_VERSION = 'beta-local-3'

// ── Capability definitions ──────────────────────────────────────────

export type Capability =
  | 'identity.invite'
  | 'identity.register'
  | 'organization.create'
  | 'property.create'
  | 'property.connect_gbp'
  | 'property.import_gbp_v2'
  | 'property.read_gbp_performance'
  | 'property.publish_reply'
  | 'notification.send_email'
  | 'notification.in_app'
  | 'portal.read'
  | 'portal.write'
  | 'portal.upload'
  | 'portal.public_read'
  | 'portal.guest_response'
  | 'portal.guest_text'
  | 'portal.guest_contact'
  | 'portal.guest_media'
  | 'team.use'
  | 'goal.use'
  | 'badge.use'
  | 'leaderboard.use'
  | 'ai.analyze'
  | 'ai.generate_reply'
  | 'ai.detect_trends'
  | 'gbp.reply.auto_publish'
  | 'gbp.ai.cross_property_summary'
  | 'gbp.review_solicitation_gamification'
  // BQR-4.1: explicit surface capabilities for master-plan enabled contexts
  | 'review.use'
  | 'inbox.use'
  | 'dashboard.use'
  | 'staff.use'
  | 'integration.use'
  | 'activity.use'
  | 'metric.internal'

/**
 * Core capabilities are ON by default for all authenticated users in beta.
 * These represent the minimum viable product surface (master plan §4).
 *
 * BQR-0 (2026-07): `portal.read` was removed from core. Portal and Guest are
 * dark for internal beta. BQR-4.1 adds explicit core surface caps for review,
 * inbox, dashboard, staff, integration, activity, and in-app notification.
 */
const CORE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'identity.invite',
  'property.create',
  'property.connect_gbp',
  'property.publish_reply',
  'review.use',
  'inbox.use',
  'dashboard.use',
  'staff.use',
  'integration.use',
  'activity.use',
  'notification.in_app',
  'metric.internal',
])

/**
 * Capabilities that are always off and can never be allowlisted.
 *
 * Google policy permanently prohibits automated reply publishing,
 * cross-property AI summaries, and review-solicitation gamification.
 *
 * `portal.upload` is a temporary SEC-01 safety containment. Remove it from
 * this set only after upload finalization accepts a durable, tenant-bound
 * issuance ID instead of an object key, storage revalidates the uploaded
 * object, derivative keys cannot alias the source, stale workers fail closed,
 * and the cross-tenant/replay/expiry/oversize adversarial suite passes.
 *
 * Other Portal, guest, and product-email capabilities are non-core
 * controlled-beta features: they remain off by default and require persisted
 * organization/property policy.
 */
const BLOCKED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'portal.upload',
  'gbp.reply.auto_publish',
  'gbp.ai.cross_property_summary',
  'gbp.review_solicitation_gamification',
])

// ── Decision types ──────────────────────────────────────────────────

export type CapabilityDenyReason =
  | 'capability_disabled'
  | 'org_not_allowlisted'
  | 'property_not_allowlisted'
  | 'org_suspended'
  | 'property_suspended'
  | 'unknown_capability'
  | 'missing_policy'
  | 'capability_blocked'

export type CapabilityDecision = Readonly<{
  allowed: boolean
  reason: CapabilityDenyReason | 'allowed'
  capability: Capability
}>

// ── Policy store interface ──────────────────────────────────────────

/**
 * The policy store determines which orgs/properties are allowlisted for
 * non-core capabilities. The initial implementation is in-memory and
 * configured via environment; a future DB-backed implementation will
 * persist allowlists and operator decisions.
 */
export type CapabilityPolicyStore = Readonly<{
  isCapabilityGloballyEnabled: (cap: Capability) => boolean
  /** Environment stop control; authoritative over tenant allowlists. */
  isCapabilityKilled?: (cap: Capability) => boolean
  isOrgAllowlisted: (orgId: string, cap: Capability) => boolean
  isPropertyAllowlisted: (propertyId: string, cap: Capability) => boolean
  isOrgSuspended: (orgId: string) => boolean
  isPropertySuspended: (propertyId: string) => boolean
}>

// ── Default in-memory policy store ──────────────────────────────────

/**
 * Creates a policy store from environment configuration.
 *
 * Environment variables:
 * - BETA_CAPABILITIES_OFF — capability kill switch (BQC-0.4): '1'/'true'/'all'
 *   disables ALL capabilities; a comma-separated list disables exactly those
 *   capabilities (e.g. property.connect_gbp,property.publish_reply stops
 *   Google sync/import/publish). Empty/absent = none off.
 * - BETA_ALLOWLIST_ORGS — comma-separated org IDs allowed to use non-core capabilities
 * - BETA_E2E_GLOBAL_CAPABILITIES — comma-separated non-core capabilities forced ON
 *   globally for E2E/CI only (never blocked capabilities). Used so Playwright
 *   can exercise register/login without changing production beta posture.
 */
export function createEnvCapabilityPolicyStore(
  env: Readonly<Record<string, string | undefined>>,
): CapabilityPolicyStore {
  const killAll = isKillSwitchAll(env)
  const killedCapabilities = new Set(parseKilledCapabilities(env))
  const allowlistedOrgs = new Set(
    (env.BETA_ALLOWLIST_ORGS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const suspendedOrgs = new Set(
    (env.BETA_SUSPENDED_ORGS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const e2eGlobalCapabilities = new Set(
    (env.BETA_E2E_GLOBAL_CAPABILITIES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

  return {
    isCapabilityKilled: (cap) => killAll || killedCapabilities.has(cap),
    isCapabilityGloballyEnabled: (cap) => {
      if (killAll) return false
      // BQC-0.4: per-capability kill list (granular stop control)
      if (killedCapabilities.has(cap)) return false
      // Blocked capabilities are never globally enabled
      if (BLOCKED_CAPABILITIES.has(cap)) return false
      // Core capabilities are globally enabled
      if (CORE_CAPABILITIES.has(cap)) return true
      // E2E/CI override for selected non-core capabilities
      if (e2eGlobalCapabilities.has(cap)) return true
      // Non-core capabilities require per-org allowlist
      return false
    },
    isOrgAllowlisted: (orgId, cap) => {
      // Core capabilities don't need allowlisting
      if (CORE_CAPABILITIES.has(cap)) return true
      // Blocked capabilities are never allowlisted
      if (BLOCKED_CAPABILITIES.has(cap)) return false
      // Non-core: check the allowlist
      return allowlistedOrgs.has(orgId)
    },
    isPropertyAllowlisted: (_propertyId, _cap) => {
      // Property-level allowlisting deferred to future DB-backed implementation
      return true
    },
    isOrgSuspended: (orgId) => suspendedOrgs.has(orgId),
    isPropertySuspended: () => false,
  }
}

// ── Test-only override guard (BQC-0.3 / SPEC-P0-03) ─────────────────

/**
 * Minimal env shape the override guard reads. Structural, so the parsed Env
 * from getEnv() fits directly. Allowlist/suspension fields are accepted (so
 * callers can pass the full env) but never recorded.
 */
export type CapabilityPolicyEnv = Readonly<{
  NODE_ENV?: string
  BETA_E2E_GLOBAL_CAPABILITIES?: string
  BETA_E2E_EXECUTION_IDENTITY?: string
  // Review §5.1 / BQC-6.8: the auth rate-limit hatch. Sibling of the
  // capability override above and authorized by the same execution identity;
  // read by isE2ERateLimitBypassAuthorized / assertE2ERateLimitBypassIdentity.
  E2E?: string
  BETA_CAPABILITIES_OFF?: string
  BETA_ALLOWLIST_ORGS?: string
  BETA_SUSPENDED_ORGS?: string
  // BQC-7.5: named-operator allowlist — read by the policy-store init when
  // binding the ExecutionPolicy operator branch (parseOperatorIdentities).
  OPS_OPERATOR_IDENTITIES?: string
}>

/** Parse the override variable into non-empty, blocked-filtered capabilities. */
export function parseE2EGlobalOverrides(
  env: CapabilityPolicyEnv,
): ReadonlyArray<Capability> {
  return (env.BETA_E2E_GLOBAL_CAPABILITIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Capability => s.length > 0)
    .filter((cap) => !isBlockedCapability(cap))
    .sort()
}

/** True when BETA_CAPABILITIES_OFF is the whole-switch form ('1'/'true'/'all'). */
export function isKillSwitchAll(env: CapabilityPolicyEnv): boolean {
  const raw = (env.BETA_CAPABILITIES_OFF ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'all'
}

/**
 * Sorted per-capability kill list from BETA_CAPABILITIES_OFF (BQC-0.4 stop
 * control). Empty when the switch is absent or in whole-switch form (see
 * isKillSwitchAll). Unknown entries are inert but recorded for truthfulness.
 */
export function parseKilledCapabilities(env: CapabilityPolicyEnv): ReadonlyArray<string> {
  if (isKillSwitchAll(env)) return []
  return (env.BETA_CAPABILITIES_OFF ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
}

/**
 * The single authorization rule for every test-only override in this module:
 * an explicit test/CI execution identity — NODE_ENV=test, or
 * BETA_E2E_EXECUTION_IDENTITY naming the test runner (CI e2e runs a
 * production-mode app, so the identity var is what authorizes overrides there).
 */
function hasE2EExecutionIdentity(env: CapabilityPolicyEnv): boolean {
  return (
    env.NODE_ENV === 'test' || (env.BETA_E2E_EXECUTION_IDENTITY ?? '').trim().length > 0
  )
}

/**
 * Refuse when BETA_E2E_GLOBAL_CAPABILITIES is non-empty outside an explicit
 * test/CI execution identity (see hasE2EExecutionIdentity). Throws on
 * violation.
 */
export function assertE2EOverrideIdentity(env: CapabilityPolicyEnv): void {
  const hasOverride = (env.BETA_E2E_GLOBAL_CAPABILITIES ?? '')
    .split(',')
    .some((s) => s.trim().length > 0)
  if (!hasOverride) return
  if (hasE2EExecutionIdentity(env)) return

  throw new Error(
    '[CAPABILITY POLICY] BETA_E2E_GLOBAL_CAPABILITIES is a test-only override and ' +
      `refuses to boot outside an explicit test/CI execution identity ` +
      `(NODE_ENV=${env.NODE_ENV ?? '(unset)'}; set NODE_ENV=test or ` +
      'BETA_E2E_EXECUTION_IDENTITY for e2e runs).',
  )
}

// ── Auth rate-limit hatch (review §5.1) ─────────────────────────────
//
// E2E stands both auth brute-force layers down for the Playwright-launched
// stack: the shared Redis limiter on the /api/auth/* catch-all
// (routes/api/auth/$.ts) and better-auth's own limiter (shared/auth/auth.ts).
// It used to be read as bare truthiness with no schema entry, no boot guard
// and no log line, so one stray env var opened credential stuffing against a
// closed-beta deployment silently. It is now a sibling of the capability
// override above: an exact value, the same execution-identity authorization,
// the same startup refusal, and fail-closed (limiters stay ON) wherever the
// claim is unauthorized — including the web process, whose nitro plugins are
// registered explicitly (vite.config.ts) and do NOT include the capability
// boot guard, so no startup assertion runs there. Web is guarded only by these
// call-site primitives; an unauthorized claim therefore surfaces as a refused
// hatch and 429s, never as a boot failure.

/** The ONLY value of E2E that requests the auth rate-limit bypass. */
const E2E_RATE_LIMIT_BYPASS_VALUE = '1'

/** True when E2E carries any value at all — a bypass claim, authorized or not. */
export function claimsE2ERateLimitBypass(env: CapabilityPolicyEnv): boolean {
  return (env.E2E ?? '').trim().length > 0
}

/**
 * True when the auth brute-force limiters may stand down: E2E is exactly '1'
 * AND an explicit test/CI execution identity authorizes it. Every other
 * state — absent, any other value, or no identity — keeps both limiters ON.
 */
export function isE2ERateLimitBypassAuthorized(env: CapabilityPolicyEnv): boolean {
  return (
    (env.E2E ?? '').trim() === E2E_RATE_LIMIT_BYPASS_VALUE && hasE2EExecutionIdentity(env)
  )
}

/**
 * Refuse startup when E2E is set outside an explicit test/CI execution
 * identity (see hasE2EExecutionIdentity). The counterpart of
 * assertE2EOverrideIdentity for the rate-limit hatch. Throws on violation.
 */
export function assertE2ERateLimitBypassIdentity(env: CapabilityPolicyEnv): void {
  if (!claimsE2ERateLimitBypass(env)) return
  if (hasE2EExecutionIdentity(env)) return

  throw new Error(
    '[AUTH RATE LIMIT] E2E is a test-only switch that disables BOTH auth ' +
      'brute-force limiters and refuses to boot outside an explicit test/CI ' +
      `execution identity (NODE_ENV=${env.NODE_ENV ?? '(unset)'}; set ` +
      'NODE_ENV=test or BETA_E2E_EXECUTION_IDENTITY for e2e runs, or unset E2E).',
  )
}

/**
 * Production boot assertion: no blocked capability may be globally enabled,
 * regardless of policy-store configuration. Throws on violation.
 */
export function assertBlockedCapabilitiesContained(store: CapabilityPolicyStore): void {
  for (const cap of listBlockedCapabilities()) {
    if (store.isCapabilityGloballyEnabled(cap)) {
      throw new Error(
        `[CAPABILITY POLICY] blocked capability "${cap}" is globally enabled at boot. ` +
          'Blocked capabilities must never boot enabled.',
      )
    }
  }
}

// ── Capability checker ──────────────────────────────────────────────

let _store: CapabilityPolicyStore | undefined

/**
 * BQC-7.8: the restore-isolated policy store — every capability globally
 * disabled, no org/property allowlisted. Core capabilities deny
 * 'capability_disabled', non-core 'org_not_allowlisted', blocked
 * 'capability_blocked' (the blocked check runs first in checkBetaCapability).
 * The effect: every capability-gated server function, job gate, and operator
 * command that declares a capability denies fail-closed while reads stay
 * available — the restore drill's verification posture.
 */
const RESTORE_ISOLATED_STORE: CapabilityPolicyStore = {
  isCapabilityGloballyEnabled: () => false,
  isOrgAllowlisted: () => false,
  isPropertyAllowlisted: () => false,
  isOrgSuspended: () => false,
  isPropertySuspended: () => false,
}

/** Initialize the capability policy store. Call once at startup. */
export function initCapabilityPolicyStore(store: CapabilityPolicyStore): void {
  _store = store
}

/** Get the current policy store, initializing from env if not yet set. */
function getStore(): CapabilityPolicyStore {
  // BQC-7.8: restore-isolated mode wins over ANY installed/configured store
  // (env, composite env+persisted, or test-injected) — read per evaluation so
  // the posture holds in every process shape (built server, vite dev, worker)
  // and lifts the moment RESTORE_MODE is unset. See src/shared/config/
  // restore-mode.ts.
  if (isRestoreIsolated(process.env)) return RESTORE_ISOLATED_STORE
  if (!_store) {
    // BQC-0.3: this lazy env fallback is the backdoor SPEC-P0-03 warns about.
    // Fail closed when the test-only override leaks outside an explicit
    // test/CI identity — covers processes the startup boot guard cannot
    // reach (e.g. vite dev server, where Nitro plugins do not execute).
    assertE2EOverrideIdentity(process.env)
    const store = createEnvCapabilityPolicyStore(process.env)
    assertBlockedCapabilitiesContained(store)
    _store = store
  }
  return _store
}

/** Reset the store — useful for tests. */
export function resetCapabilityPolicyStore(): void {
  _store = undefined
}

/**
 * Check capability posture against already-resolved tenant/property scope.
 * This is the shared decision for authenticated callers, opaque public
 * resources, and scoped delayed work. It deliberately does not authorize a
 * role or grant; ExecutionPolicy composes those layers for user principals.
 */
export function checkScopedCapability(
  scope: Readonly<{ organizationId: string; propertyId?: string }>,
  capability: Capability,
): CapabilityDecision {
  const store = getStore()
  if (BLOCKED_CAPABILITIES.has(capability)) {
    return { allowed: false, reason: 'capability_blocked', capability }
  }
  if (store.isCapabilityKilled?.(capability)) {
    return { allowed: false, reason: 'capability_disabled', capability }
  }
  if (store.isOrgSuspended(scope.organizationId)) {
    return { allowed: false, reason: 'org_suspended', capability }
  }
  if (scope.propertyId && store.isPropertySuspended(scope.propertyId)) {
    return { allowed: false, reason: 'property_suspended', capability }
  }
  if (!store.isCapabilityGloballyEnabled(capability)) {
    if (CORE_CAPABILITIES.has(capability)) {
      return { allowed: false, reason: 'capability_disabled', capability }
    }
    if (!store.isOrgAllowlisted(scope.organizationId, capability)) {
      return { allowed: false, reason: 'org_not_allowlisted', capability }
    }
  }
  if (
    scope.propertyId &&
    !CORE_CAPABILITIES.has(capability) &&
    !store.isPropertyAllowlisted(scope.propertyId, capability)
  ) {
    return { allowed: false, reason: 'property_not_allowlisted', capability }
  }
  return { allowed: true, reason: 'allowed', capability }
}

export function checkBetaCapability(
  ctx: AuthContext,
  capability: Capability,
  propertyId?: string,
): CapabilityDecision {
  return checkScopedCapability(
    { organizationId: ctx.organizationId, ...(propertyId ? { propertyId } : {}) },
    capability,
  )
}

/**
 * Assert that a capability is allowed. Throws if denied.
 * Use in server functions and use cases before performing mutations or external effects.
 */
export function assertBetaCapability(
  ctx: AuthContext,
  capability: Capability,
  propertyId?: string,
): void {
  const decision = checkBetaCapability(ctx, capability, propertyId)
  if (!decision.allowed) {
    throw new BetaCapabilityError(decision)
  }
}

/**
 * Check if a capability is globally enabled (no org/property context).
 * Use in unauthenticated endpoints (registration, public APIs) where
 * there is no AuthContext yet.
 */
export function checkGlobalCapability(capability: Capability): CapabilityDecision {
  const store = getStore()

  if (BLOCKED_CAPABILITIES.has(capability)) {
    return { allowed: false, reason: 'capability_blocked', capability }
  }

  if (!store.isCapabilityGloballyEnabled(capability)) {
    return { allowed: false, reason: 'capability_disabled', capability }
  }

  return { allowed: true, reason: 'allowed', capability }
}

/**
 * Assert that a capability is globally enabled. For unauthenticated endpoints.
 * Throws if the capability is disabled or blocked.
 */
export function assertGlobalCapability(capability: Capability): void {
  const decision = checkGlobalCapability(capability)
  if (!decision.allowed) {
    throw new BetaCapabilityError(decision)
  }
}

/** Error thrown when a capability check fails. */
export class BetaCapabilityError extends Error {
  constructor(public readonly decision: CapabilityDecision) {
    super(`Capability "${decision.capability}" denied: ${decision.reason}`)
    this.name = 'BetaCapabilityError'
  }
}

export function isCoreCapability(cap: Capability): boolean {
  return CORE_CAPABILITIES.has(cap)
}

export function isBlockedCapability(cap: Capability): boolean {
  return BLOCKED_CAPABILITIES.has(cap)
}

/** Sorted core capability list — for the boot manifest (BQC-0.3). */
export function listCoreCapabilities(): ReadonlyArray<Capability> {
  return [...CORE_CAPABILITIES].sort()
}

/** Sorted blocked capability list — for boot assertions and the manifest. */
export function listBlockedCapabilities(): ReadonlyArray<Capability> {
  return [...BLOCKED_CAPABILITIES].sort()
}

/** Complete capability vocabulary used by policy administration and guards. */
export function listAllCapabilities(): ReadonlyArray<Capability> {
  const nonCore: ReadonlyArray<Capability> = [
    'identity.register',
    'organization.create',
    'property.import_gbp_v2',
    'property.read_gbp_performance',
    'notification.send_email',
    'portal.read',
    'portal.write',
    'portal.upload',
    'portal.public_read',
    'portal.guest_response',
    'portal.guest_text',
    'portal.guest_contact',
    'portal.guest_media',
    'team.use',
    'goal.use',
    'badge.use',
    'leaderboard.use',
    'ai.analyze',
    'ai.generate_reply',
    'ai.detect_trends',
  ]
  return [...CORE_CAPABILITIES, ...BLOCKED_CAPABILITIES, ...nonCore].sort()
}

/**
 * Registration gate for handlers and schedules. Promotable jobs stay
 * registered even while no tenant is allowlisted; enqueue, dispatch, and
 * execution perform scoped decisions. Restore isolation and permanent
 * prohibitions remain contained at registration.
 */
export function isCapabilityJobEnabled(capability: Capability): boolean {
  return !isRestoreIsolated(process.env) && !BLOCKED_CAPABILITIES.has(capability)
}

/**
 * Dark beta contexts and the capability that must be asserted on every
 * production entry path (server functions, jobs, schedules).
 * Kept here so architecture tests and worker containment share one list.
 */
/**
 * Primary dark capability per context (architecture scan default).
 * Portal also uses portal.write / portal.upload on mutation/media paths (BQC-0.2);
 * those are listed in PORTAL_DARK_CAPABILITIES.
 */
export const DARK_CONTEXT_CAPABILITIES = {
  team: 'team.use',
  portal: 'portal.read',
  guest: 'portal.read',
  goal: 'goal.use',
  badge: 'badge.use',
  leaderboard: 'leaderboard.use',
} as const satisfies Readonly<Record<string, Capability>>

/** All capabilities used by Portal management and the public/guest edge. */
export const PORTAL_DARK_CAPABILITIES = [
  'portal.read',
  'portal.write',
  'portal.upload',
  'portal.public_read',
  'portal.guest_response',
  'portal.guest_text',
  'portal.guest_contact',
  'portal.guest_media',
] as const satisfies ReadonlyArray<Capability>
