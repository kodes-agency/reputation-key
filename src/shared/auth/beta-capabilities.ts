// BetaCapabilities — server-side feature-gate policy for the closed beta.
//
// Capabilities are distinct from permissions. Permissions are role-based
// ("can user X do action Y in their org?"). Capabilities are feature gates
// ("is feature Y running for this org in this environment?").
//
// A server function should check capability FIRST, then permission:
//   1. checkBetaCapability(ctx, 'property.publish_reply') — is the feature on?
//   2. canForContext(ctx, 'property.publish_reply') — does the role allow it?
//
// Every capability whose fate allows it is on. Four switches turn groups of
// them off (capability-fate.ts says which group each belongs to): Google
// calls, AI calls, Guest pages and Optional email. Two controls sit above
// them: everything off, and one suspended Organization. Blocked fates never
// run. Merchant per-Property AI consent is decided by the ExecutionPolicy, not
// here.
//
// RESTORE_MODE=isolated (restore drills) overrides every installed or
// configured store at the getStore() seam below: all capabilities deny
// fail-closed while the mode is set.

import type { AuthContext } from '#/shared/domain/auth-context'
import { isRestoreIsolated } from '#/shared/config/restore-mode'
import {
  CAPABILITIES,
  CAPABILITY_FATE,
  FEATURE_SWITCHES,
  listCapabilitiesByFate,
  type Capability,
  type FeatureSwitch,
} from '#/shared/governance/capability-fate'

export { CAPABILITIES, FEATURE_SWITCHES }
export type { Capability, FeatureSwitch }

/**
 * Capability-policy version. Bump when capability vocabulary or posture changes.
 * Recorded in the boot and release manifests.
 */
export const CAPABILITY_POLICY_VERSION = 'beta-local-13'

// ── Runtime capability posture ──────────────────────────────────────

const BLOCKED_CAPABILITIES: ReadonlySet<Capability> = new Set([
  ...listCapabilitiesByFate('beta_disabled'),
  ...listCapabilitiesByFate('safety_blocked'),
  ...listCapabilitiesByFate('permanently_denied'),
])

// ── Decision types ──────────────────────────────────────────────────

export type CapabilityDenyReason =
  'capability_disabled' | 'org_suspended' | 'capability_blocked'

export type CapabilityDecision = Readonly<{
  allowed: boolean
  reason: CapabilityDenyReason | 'allowed'
  capability: Capability
}>

// ── Policy store interface ──────────────────────────────────────────

/** The environment's switches and suspensions, fixed for the process lifetime. */
export type CapabilityPolicyStore = Readonly<{
  /** Everything off, or the capability's switch is off. */
  isCapabilityKilled: (cap: Capability) => boolean
  isOrgSuspended: (orgId: string) => boolean
}>

/** The Organization IDs named in `BETA_SUSPENDED_ORGS`. */
export function parseSuspendedOrgs(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

/**
 * Minimal env shape the policy reads. Structural, so the parsed Env from
 * getEnv() fits directly. Suspension fields are accepted (so callers can pass
 * the full env) but never recorded.
 */
export type CapabilityPolicyEnv = Readonly<{
  NODE_ENV?: string
  BETA_E2E_EXECUTION_IDENTITY?: string
  // The auth rate-limit hatch, authorized by the execution identity above;
  // read by isE2ERateLimitBypassAuthorized / assertE2ERateLimitBypassIdentity.
  E2E?: string
  BETA_CAPABILITIES_OFF?: string
  BETA_SUSPENDED_ORGS?: string
  // Named-operator allowlist — read by the policy-store init when binding the
  // ExecutionPolicy operator branch (parseOperatorIdentities).
  OPS_OPERATOR_IDENTITIES?: string
  // Railway's deployment identity — read only by isDeployedProcess, to refuse
  // every test-only override in a deployed process.
  RAILWAY_PROJECT_ID?: string
  RAILWAY_ENVIRONMENT_ID?: string
}>

/** True when BETA_CAPABILITIES_OFF is the everything-off form ('1'/'true'/'all'). */
export function isKillSwitchAll(env: CapabilityPolicyEnv): boolean {
  const raw = (env.BETA_CAPABILITIES_OFF ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'all'
}

function isFeatureSwitch(value: string): value is FeatureSwitch {
  return FEATURE_SWITCHES.some((name) => name === value)
}

/**
 * Why BETA_CAPABILITIES_OFF cannot be read, or null when it can. Anything but
 * everything-off or a comma list of switch names is refused rather than
 * ignored: a capability name left over from the old per-capability list would
 * otherwise turn back on what its operator turned off.
 */
export function capabilitiesOffProblem(value: string | undefined): string | null {
  if (isKillSwitchAll({ BETA_CAPABILITIES_OFF: value })) return null
  const unknown = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .find((entry) => !isFeatureSwitch(entry))
  if (unknown === undefined) return null
  return (
    `BETA_CAPABILITIES_OFF names "${unknown}", which is not a switch. Use all, or a ` +
    `comma list of: ${FEATURE_SWITCHES.join(', ')}.`
  )
}

/**
 * Sorted switches BETA_CAPABILITIES_OFF turns off. Empty when the variable is
 * absent or in everything-off form (see isKillSwitchAll). Throws on a name
 * that is not a switch (capabilitiesOffProblem).
 */
export function parseSwitchesOff(env: CapabilityPolicyEnv): ReadonlyArray<FeatureSwitch> {
  const problem = capabilitiesOffProblem(env.BETA_CAPABILITIES_OFF)
  if (problem !== null) throw new Error(`[CAPABILITY POLICY] ${problem}`)
  if (isKillSwitchAll(env)) return []
  return FEATURE_SWITCHES.filter((name) =>
    (env.BETA_CAPABILITIES_OFF ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(name),
  )
}

// ── Default in-memory policy store ──────────────────────────────────

/**
 * True in a deployed process. Railway injects these opaque IDs into every
 * deployment and nothing local or in CI sets them — the same pair refuses
 * DEPLOY_MIGRATE=1 (shared/db/deploy-migration-runtime.ts). Any non-empty
 * value counts, a blank one included, as it does there: a value nobody can
 * vouch for must not read as "not deployed".
 */
function isDeployedProcess(
  env: Readonly<{ RAILWAY_PROJECT_ID?: string; RAILWAY_ENVIRONMENT_ID?: string }>,
): boolean {
  return Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID)
}

/**
 * Creates a policy store from environment configuration. Throws when
 * BETA_CAPABILITIES_OFF names something that is not a switch.
 *
 * Environment variables:
 * - BETA_CAPABILITIES_OFF — '1'/'true'/'all' turns everything off; a comma
 *   list of switches (google, ai, guest_pages, optional_email) turns those
 *   groups off. Empty/absent = everything on.
 * - BETA_SUSPENDED_ORGS — comma-separated Organization IDs (not slugs) whose
 *   every capability check is denied with `org_suspended`. Absent/empty
 *   suspends none.
 */
export function createEnvCapabilityPolicyStore(
  env: Readonly<Record<string, string | undefined>>,
): CapabilityPolicyStore {
  const killAll = isKillSwitchAll(env)
  const switchesOff = new Set<FeatureSwitch>(parseSwitchesOff(env))
  const suspendedOrgs = parseSuspendedOrgs(env.BETA_SUSPENDED_ORGS)

  return {
    isCapabilityKilled: (cap) => {
      if (killAll) return true
      const featureSwitch = CAPABILITY_FATE[cap].featureSwitch
      return featureSwitch !== null && switchesOff.has(featureSwitch)
    },
    isOrgSuspended: (orgId) => suspendedOrgs.has(orgId),
  }
}

// ── Test-only execution identity ────────────────────────────────────

/**
 * The single authorization rule for every test-only override in this module:
 * an explicit test/CI execution identity — NODE_ENV=test, or
 * BETA_E2E_EXECUTION_IDENTITY naming the test runner (CI e2e runs a
 * production-mode app, so the identity var is what authorizes overrides there).
 *
 * A deployed process never has one. The identity is free text that travels
 * with the hatches it authorizes (compose.local.yml sets them together), so a
 * copy of the e2e stack's variables onto a deployed service would otherwise
 * authorize itself.
 */
function hasE2EExecutionIdentity(env: CapabilityPolicyEnv): boolean {
  if (isDeployedProcess(env)) return false
  return (
    env.NODE_ENV === 'test' || (env.BETA_E2E_EXECUTION_IDENTITY ?? '').trim().length > 0
  )
}

/** How a refused override ends its sentence: why, and what the operator does. */
function e2eOverrideRefusal(env: CapabilityPolicyEnv, variable: string): string {
  if (isDeployedProcess(env)) {
    return (
      'is refused on Railway, whatever execution identity is set. ' +
      `Unset ${variable} on the deployed service.`
    )
  }
  return (
    'refuses to boot outside an explicit test/CI execution identity ' +
    `(NODE_ENV=${env.NODE_ENV ?? '(unset)'}; set NODE_ENV=test or ` +
    `BETA_E2E_EXECUTION_IDENTITY for e2e runs, or unset ${variable}).`
  )
}

// ── Auth rate-limit hatch (review §5.1) ─────────────────────────────
//
// E2E stands both auth brute-force layers down for the Playwright-launched
// stack: the shared Redis limiter on the /api/auth/* catch-all
// (routes/api/auth/$.ts) and better-auth's own limiter (shared/auth/auth.ts).
// It used to be read as bare truthiness with no schema entry, no boot guard
// and no log line, so one stray env var opened credential stuffing against a
// closed-beta deployment silently. It is now an exact value with an
// execution-identity authorization and a startup refusal, and fail-closed (limiters stay ON) wherever the
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
 * state — absent, any other value, no identity, or a deployed process —
 * keeps both limiters ON.
 */
export function isE2ERateLimitBypassAuthorized(env: CapabilityPolicyEnv): boolean {
  return (
    (env.E2E ?? '').trim() === E2E_RATE_LIMIT_BYPASS_VALUE && hasE2EExecutionIdentity(env)
  )
}

/**
 * Refuse startup when E2E is set outside an explicit test/CI execution
 * identity, or in any deployed process (see hasE2EExecutionIdentity). Throws
 * on violation.
 */
export function assertE2ERateLimitBypassIdentity(env: CapabilityPolicyEnv): void {
  if (!claimsE2ERateLimitBypass(env)) return
  if (hasE2EExecutionIdentity(env)) return

  throw new Error(
    '[AUTH RATE LIMIT] E2E is a test-only switch that disables BOTH auth ' +
      `brute-force limiters and ${e2eOverrideRefusal(env, 'E2E')}`,
  )
}

// ── Capability checker ──────────────────────────────────────────────

let _store: CapabilityPolicyStore | undefined

/**
 * The restore-isolated policy store: everything off, so every
 * capability-gated server function, job gate and operator command that
 * declares a capability denies fail-closed while reads stay available — the
 * restore drill's verification posture.
 */
const RESTORE_ISOLATED_STORE: CapabilityPolicyStore = {
  isCapabilityKilled: () => true,
  isOrgSuspended: () => false,
}

/**
 * Initialize the capability policy store. Call once at startup.
 *
 * Application processes install through the single owner
 * (shared/auth/process-policy-binding.bindProcessPolicies), which binds this
 * store together with the two policies that read it — a half-swapped trio can
 * make a decision consult another container's tenant state or consent reader.
 * The boot guard and tests still install directly.
 */
export function initCapabilityPolicyStore(store: CapabilityPolicyStore): void {
  _store = store
}

/** Get the current policy store, initializing from env if not yet set. */
function getStore(): CapabilityPolicyStore {
  // Restore-isolated mode wins over ANY installed or configured store, read
  // per evaluation so the posture holds in every process shape (built server,
  // vite dev, worker) and lifts the moment RESTORE_MODE is unset. See
  // src/shared/config/restore-mode.ts.
  if (isRestoreIsolated(process.env)) return RESTORE_ISOLATED_STORE
  _store ??= createEnvCapabilityPolicyStore(process.env)
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
  if (store.isCapabilityKilled(capability)) {
    return { allowed: false, reason: 'capability_disabled', capability }
  }
  if (store.isOrgSuspended(scope.organizationId)) {
    return { allowed: false, reason: 'org_suspended', capability }
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
 * Check a capability with no Organization in scope: blocked fates and the
 * switches decide, suspension cannot. Use in unauthenticated endpoints
 * (registration, public APIs) and for environment-wide readings.
 */
export function checkGlobalCapability(capability: Capability): CapabilityDecision {
  if (BLOCKED_CAPABILITIES.has(capability)) {
    return { allowed: false, reason: 'capability_blocked', capability }
  }
  if (getStore().isCapabilityKilled(capability)) {
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

export function isBlockedCapability(cap: Capability): boolean {
  return BLOCKED_CAPABILITIES.has(cap)
}

/** Sorted blocked capability list — for the boot manifest. */
export function listBlockedCapabilities(): ReadonlyArray<Capability> {
  return [...BLOCKED_CAPABILITIES].sort()
}

/** Complete capability vocabulary used by policy administration and guards. */
export function listAllCapabilities(): ReadonlyArray<Capability> {
  return [...CAPABILITIES].sort()
}

/**
 * Registration gate for handlers and schedules. Jobs stay registered while
 * their switch is off; enqueue, dispatch, and execution perform scoped
 * decisions. Restore isolation and permanent
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
  portal: 'portal.read',
  guest: 'portal.read',
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
