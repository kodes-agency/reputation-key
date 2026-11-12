// CapabilityBootGuard — startup containment for the capability policy.
//
// This module runs at true process startup where an app-level entry exists
// (the worker — a plain Node process) and:
//   1. Refuses startup when E2E — the hatch that stands BOTH auth
//      brute-force limiters down — is set outside an explicit test/CI
//      execution identity (assertE2ERateLimitBypassIdentity). A deployed
//      process has no such identity: with a Railway project or environment id
//      present, it refuses whatever BETA_E2E_EXECUTION_IDENTITY says.
//   2. Refuses startup when BETA_CAPABILITIES_OFF names something that is not
//      a switch (createEnvCapabilityPolicyStore throws).
//   3. Eagerly initializes the global policy store and records the
//      capability-policy version + effective beta manifest at startup —
//      switches only, never tenant/org identifiers, plus whether the auth
//      rate-limit hatch is in effect.
//
// This guard does not run in the web server: vite.config.ts registers nitro
// plugins by explicit list, and that list does not include this module. The
// web composition root builds the same store (policy-store-init.ts), so an
// unreadable BETA_CAPABILITIES_OFF refuses web's startup too, and readiness
// reports it (shared/health/readiness.ts). The rate-limit hatch is fail-closed
// at its call sites — an unauthorized E2E claim leaves both limiters ON, so it
// costs 429s rather than a refused boot.
//
// Unit/component tests inject policy stores via initCapabilityPolicyStore
// (see beta-capabilities.ts).

import {
  CAPABILITY_POLICY_VERSION,
  assertE2ERateLimitBypassIdentity,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  isE2ERateLimitBypassAuthorized,
  isKillSwitchAll,
  listBlockedCapabilities,
  parseSwitchesOff,
  type Capability,
  type CapabilityPolicyEnv,
  type FeatureSwitch,
} from './beta-capabilities'

export type { CapabilityPolicyEnv }

/** Effective beta manifest recorded at startup. No tenant/content data. */
export type CapabilityBootManifest = Readonly<{
  policyVersion: string
  nodeEnv: string
  /** Everything off ('1'/'true'/'all'). */
  killSwitchActive: boolean
  /** Switches turned off (empty when everything is off or none is). */
  switchesOff: ReadonlyArray<FeatureSwitch>
  blockedCapabilities: ReadonlyArray<Capability>
  /**
   * Whether the E2E hatch has stood the auth brute-force limiters down in
   * this process — the health signal the hatch never had.
   */
  authRateLimitBypass: boolean
  e2eExecutionIdentity?: string
}>

export type CapabilityBootLogger = Readonly<{
  info: (obj: unknown, msg: string) => void
}>

/**
 * Build the effective beta manifest for startup logging. Contains capability
 * posture only — suspended org IDs are deliberately excluded.
 */
export function buildCapabilityBootManifest(
  env: CapabilityPolicyEnv,
): CapabilityBootManifest {
  const identity = (env.BETA_E2E_EXECUTION_IDENTITY ?? '').trim()
  return {
    policyVersion: CAPABILITY_POLICY_VERSION,
    nodeEnv: env.NODE_ENV ?? '(unset)',
    killSwitchActive: isKillSwitchAll(env),
    switchesOff: parseSwitchesOff(env),
    blockedCapabilities: listBlockedCapabilities(),
    authRateLimitBypass: isE2ERateLimitBypassAuthorized(env),
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
  assertE2ERateLimitBypassIdentity(env)
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  const manifest = buildCapabilityBootManifest(env)
  logger.info({ capabilityPolicy: manifest }, 'capability policy boot manifest')
  return manifest
}
