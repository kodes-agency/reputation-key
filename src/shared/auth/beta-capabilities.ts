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

import type { AuthContext } from '#/shared/domain/auth-context'

/**
 * Capability-policy version. Bump when CORE_CAPABILITIES or
 * BLOCKED_CAPABILITIES change. Recorded in the boot manifest (BQC-0.3).
 */
export const CAPABILITY_POLICY_VERSION = 'bqc-0.3'

// ── Capability definitions ──────────────────────────────────────────

export type Capability =
  | 'identity.invite'
  | 'identity.register'
  | 'organization.create'
  | 'property.create'
  | 'property.connect_gbp'
  | 'property.publish_reply'
  | 'notification.send_email'
  | 'notification.in_app'
  | 'portal.read'
  | 'portal.write'
  | 'portal.upload'
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
 * Capabilities that are always off — hard-blocked by Google policy or
 * product readiness gates. These can NEVER be allowlisted.
 *
 * Google response (2026-07-14): AI analysis, reply drafts, and trends are
 * conditionally permitted per-property — they move to non-core (off by
 * default, allowlistable per-org). The following remain hard-blocked:
 *   - gbp.reply.auto_publish: Google prohibits automated AI reply publishing
 *   - gbp.ai.cross_property_summary: Google prohibits cross-property combination
 *   - gbp.review_solicitation_gamification: Google prohibits review-solicitation
 *     gamification (review clicks/scans/volume never drive goals/badges/leaderboards)
 *   - notification.send_email: product gate (beta decision, not Google)
 *   - portal.write, portal.upload: product gate (beta decision)
 */
const BLOCKED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'gbp.reply.auto_publish',
  'gbp.ai.cross_property_summary',
  'gbp.review_solicitation_gamification',
  'notification.send_email',
  'portal.write',
  'portal.upload',
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
 * - BETA_CAPABILITIES_OFF=1 — global kill switch, disables ALL capabilities
 * - BETA_ALLOWLIST_ORGS — comma-separated org IDs allowed to use non-core capabilities
 * - BETA_E2E_GLOBAL_CAPABILITIES — comma-separated non-core capabilities forced ON
 *   globally for E2E/CI only (never blocked capabilities). Used so Playwright
 *   can exercise register/login without changing production beta posture.
 */
export function createEnvCapabilityPolicyStore(
  env: Readonly<Record<string, string | undefined>>,
): CapabilityPolicyStore {
  const globalOff = env.BETA_CAPABILITIES_OFF === '1'
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
    isCapabilityGloballyEnabled: (cap) => {
      if (globalOff) return false
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
  BETA_CAPABILITIES_OFF?: string
  BETA_ALLOWLIST_ORGS?: string
  BETA_SUSPENDED_ORGS?: string
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

/**
 * Refuse when BETA_E2E_GLOBAL_CAPABILITIES is non-empty outside an explicit
 * test/CI execution identity (NODE_ENV=test, or BETA_E2E_EXECUTION_IDENTITY
 * naming the test runner — CI e2e runs `pnpm dev`, whose script pins
 * NODE_ENV=development, so the identity var authorizes the override there).
 * Throws on violation.
 */
export function assertE2EOverrideIdentity(env: CapabilityPolicyEnv): void {
  const hasOverride = (env.BETA_E2E_GLOBAL_CAPABILITIES ?? '')
    .split(',')
    .some((s) => s.trim().length > 0)
  if (!hasOverride) return

  const isTestIdentity = env.NODE_ENV === 'test'
  const hasExplicitIdentity = (env.BETA_E2E_EXECUTION_IDENTITY ?? '').trim().length > 0
  if (isTestIdentity || hasExplicitIdentity) return

  throw new Error(
    '[CAPABILITY POLICY] BETA_E2E_GLOBAL_CAPABILITIES is a test-only override and ' +
      `refuses to boot outside an explicit test/CI execution identity ` +
      `(NODE_ENV=${env.NODE_ENV ?? '(unset)'}; set NODE_ENV=test or ` +
      'BETA_E2E_EXECUTION_IDENTITY for e2e runs).',
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

/** Initialize the capability policy store. Call once at startup. */
export function initCapabilityPolicyStore(store: CapabilityPolicyStore): void {
  _store = store
}

/** Get the current policy store, initializing from env if not yet set. */
function getStore(): CapabilityPolicyStore {
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
 * Check whether a capability is allowed for the given context.
 *
 * Returns a CapabilityDecision with `allowed: true` or a deny reason.
 * Fails closed: unknown capabilities, missing policy, or suspended
 * orgs/properties are denied.
 */
export function checkBetaCapability(
  ctx: AuthContext,
  capability: Capability,
  propertyId?: string,
): CapabilityDecision {
  const store = getStore()
  // Blocked capabilities are never allowed, regardless of store configuration.
  // This is a hard safety net — AI and external email remain off until ADR 0031.
  if (BLOCKED_CAPABILITIES.has(capability)) {
    return { allowed: false, reason: 'capability_blocked', capability }
  }

  // Check org suspension
  if (store.isOrgSuspended(ctx.organizationId)) {
    return { allowed: false, reason: 'org_suspended', capability }
  }

  // Check property suspension
  if (propertyId && store.isPropertySuspended(propertyId)) {
    return { allowed: false, reason: 'property_suspended', capability }
  }

  // Check global enablement
  if (!store.isCapabilityGloballyEnabled(capability)) {
    // If it's a core capability and globally disabled, it's a kill switch
    if (CORE_CAPABILITIES.has(capability)) {
      return { allowed: false, reason: 'capability_disabled', capability }
    }
    // Non-core: check org allowlist
    if (!store.isOrgAllowlisted(ctx.organizationId, capability)) {
      return { allowed: false, reason: 'org_not_allowlisted', capability }
    }
  }

  // Check property allowlist if property-scoped
  if (propertyId && !store.isPropertyAllowlisted(propertyId, capability)) {
    return { allowed: false, reason: 'property_not_allowlisted', capability }
  }

  return { allowed: true, reason: 'allowed', capability }
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

// ── Capability metadata for UI ──────────────────────────────────────

export const ALL_CAPABILITIES: readonly Capability[] = [
  'identity.invite',
  'identity.register',
  'organization.create',
  'property.create',
  'property.connect_gbp',
  'property.publish_reply',
  'notification.send_email',
  'portal.read',
  'portal.write',
  'portal.upload',
  'team.use',
  'goal.use',
  'badge.use',
  'leaderboard.use',
  'ai.analyze',
  'ai.generate_reply',
  'ai.detect_trends',
  'gbp.reply.auto_publish',
  'gbp.ai.cross_property_summary',
  'gbp.review_solicitation_gamification',
]

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

/**
 * Worker/schedule gate: true only when the capability is globally enabled
 * (core, not killed). Non-core and blocked capabilities return false — even
 * if individual orgs are allowlisted for interactive server functions.
 *
 * BQR-0: dark-context jobs must not schedule or run until their capability is
 * promoted to core (or an explicit later job-enablement path exists).
 */
export function isCapabilityJobEnabled(capability: Capability): boolean {
  return checkGlobalCapability(capability).allowed
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

/** All portal-surface capabilities that may appear on portal server entry paths. */
export const PORTAL_DARK_CAPABILITIES = [
  'portal.read',
  'portal.write',
  'portal.upload',
] as const satisfies ReadonlyArray<Capability>
