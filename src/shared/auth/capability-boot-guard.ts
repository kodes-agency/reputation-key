// CapabilityBootGuard — BQC-0.3 / SPEC-P0-03 containment for test-only
// capability overrides.
//
// BETA_E2E_GLOBAL_CAPABILITIES exists so browser E2E (a separate app process)
// can open registration/team surfaces without changing production posture.
// Before BQC-0.3, a production environment mistake with this variable set
// would silently open non-core capabilities on first use.
//
// This module runs at true process startup where an app-level entry exists
// (the worker — a plain Node process) and:
//   1. Refuses startup when the override is non-empty outside an explicit
//      test/CI execution identity (assertE2EOverrideIdentity).
//   2. Asserts every blocked capability is not globally enabled (production
//      boot assertion — blocked capabilities must never boot enabled).
//   3. Eagerly initializes the global policy store and records the
//      capability-policy version + effective beta manifest at startup —
//      capabilities only, never tenant/org identifiers.
//
// The web server has no working app-level startup hook in this build: the
// nitro/vite integration does not auto-discover server/plugins (the B0.7
// security-headers plugin is likewise inert — flagged for BQC-6/7). Web and
// every other process are therefore fail-closed at first capability
// evaluation: the primitives live in beta-capabilities.ts so the lazy
// getStore() fallback enforces the same rules (proven in dev and in the
// built production server, which 500s on any request when the override
// leaks without an identity).
//
// Unit/component tests do not need the env backdoor: they inject policy
// stores via initCapabilityPolicyStore (see beta-capabilities.ts).

import {
  CAPABILITY_POLICY_VERSION,
  assertBlockedCapabilitiesContained,
  assertE2EOverrideIdentity,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  listBlockedCapabilities,
  listCoreCapabilities,
  parseE2EGlobalOverrides,
  type Capability,
  type CapabilityPolicyEnv,
} from './beta-capabilities'

export type { CapabilityPolicyEnv }

/** Effective beta manifest recorded at startup. No tenant/content data. */
export type CapabilityBootManifest = Readonly<{
  policyVersion: string
  nodeEnv: string
  killSwitchActive: boolean
  coreCapabilities: ReadonlyArray<Capability>
  blockedCapabilities: ReadonlyArray<Capability>
  e2eGlobalOverrides: ReadonlyArray<Capability>
  e2eExecutionIdentity?: string
}>

export type CapabilityBootLogger = Readonly<{
  info: (obj: unknown, msg: string) => void
}>

/**
 * Build the effective beta manifest for startup logging. Contains capability
 * posture only — allowlisted/suspended org IDs are deliberately excluded.
 */
export function buildCapabilityBootManifest(
  env: CapabilityPolicyEnv,
): CapabilityBootManifest {
  const identity = (env.BETA_E2E_EXECUTION_IDENTITY ?? '').trim()
  return {
    policyVersion: CAPABILITY_POLICY_VERSION,
    nodeEnv: env.NODE_ENV ?? '(unset)',
    killSwitchActive: env.BETA_CAPABILITIES_OFF === '1',
    coreCapabilities: listCoreCapabilities(),
    blockedCapabilities: listBlockedCapabilities(),
    e2eGlobalOverrides: parseE2EGlobalOverrides(env),
    ...(identity ? { e2eExecutionIdentity: identity } : {}),
  }
}

/**
 * Run all boot-safety checks, eagerly initialize the global policy store from
 * env, and record the startup manifest. Throws (refusing startup) on any
 * violation; returns the manifest otherwise.
 */
export function runCapabilityBootGuard(
  env: CapabilityPolicyEnv,
  logger: CapabilityBootLogger,
): CapabilityBootManifest {
  assertE2EOverrideIdentity(env)
  const store = createEnvCapabilityPolicyStore(env)
  assertBlockedCapabilitiesContained(store)
  initCapabilityPolicyStore(store)
  const manifest = buildCapabilityBootManifest(env)
  logger.info({ capabilityPolicy: manifest }, 'capability policy boot manifest')
  return manifest
}
