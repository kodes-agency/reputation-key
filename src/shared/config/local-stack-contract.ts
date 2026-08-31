import type { Capability } from '#/shared/auth/beta-capabilities'

export type LocalStackMode = 'beta' | 'e2e' | 'perf'

/**
 * Non-core features promoted for the controlled local beta cohort.
 * Permanently blocked Google behaviors are deliberately absent. Portal image
 * upload is also withheld under the temporary SEC-01 containment; re-enable it
 * here only after the issuance-bound implementation and adversarial tests meet
 * the removal criteria documented beside BLOCKED_CAPABILITIES.
 */
export const LOCAL_BETA_CAPABILITIES = [
  'notification.send_email',
  'portal.read',
  'portal.write',
  'portal.public_read',
  'portal.guest_response',
  'portal.guest_text',
  'portal.guest_contact',
  'goal.use',
  'property.import_gbp_v2',
  'property.read_gbp_performance',
] as const satisfies ReadonlyArray<Capability>

/**
 * There are no process-wide E2E capability exceptions. Browser identities and
 * Organizations are seeded or created through the exact invitation workflow;
 * product capabilities come from persisted tenant policy.
 */
export const LOCAL_E2E_BOOTSTRAP_CAPABILITIES =
  [] as const satisfies ReadonlyArray<Capability>

/**
 * Capabilities `pnpm seed` deliberately withholds from a developer
 * organization. Each one reaches outside the machine or accepts unmoderated
 * anonymous input, so it must be granted per environment — with a reason and a
 * ticket, through `setOrgCapabilityFn` — rather than by running a seed script.
 *
 * Permanently blocked capabilities are absent from LOCAL_BETA_CAPABILITIES and
 * cannot be restored by a seed or test override.
 */
const SEED_WITHHELD_CAPABILITIES = [
  // Sends real email through the configured provider.
  'notification.send_email',
] as const satisfies ReadonlyArray<Capability>

/**
 * What `pnpm seed` grants a developer organization and every one of its
 * properties: the local beta cohort minus the withheld set. Derived rather
 * than restated so a capability added to the cohort cannot silently miss the
 * developer seed.
 */
export const SEED_BETA_CAPABILITIES: ReadonlyArray<Capability> =
  LOCAL_BETA_CAPABILITIES.filter(
    (capability) =>
      !(SEED_WITHHELD_CAPABILITIES as ReadonlyArray<Capability>).includes(capability),
  )

/**
 * The test/CI execution identity that AUTHORIZES the auth rate-limit hatch
 * (review §5.1) for a local stack's `web` service, per mode.
 *
 * compose.local.yml claims the hatch on `web` in every mode (`E2E: '1'`) and
 * the app fail-closes unless an identity authorizes that claim
 * (isE2ERateLimitBypassAuthorized, shared/auth/beta-capabilities.ts). This map
 * is that authorization, and it is DELIBERATELY independent of the capability
 * override below: the two answer different questions. The override asks "may
 * this stack skip tenant policy?"; the identity asks "is this process a test
 * runner that floods sign-in from one loopback address?".
 *
 * They were one coupled early-return until beta-acceptance 429'd on sign-in:
 * `beta` was withheld the identity as a side effect of being withheld the
 * override, so its web claimed a hatch it could not authorize and both auth
 * brute-force limiters stayed on under a 19-sign-in serial suite.
 *
 * - `e2e` and `beta` both drive Playwright through `web` (every spec signs in
 *   per test; better-auth allows 3 sign-ins per 10s per IP and the shared
 *   catch-all limiter 60 POSTs per 60s per IP, and retries: 0 makes one 429
 *   fatal), so both authorize the hatch — with distinct identities, so a boot
 *   log names the suite that stood the limiters down.
 * - `perf` drives no browser suite and gets NO identity: its claim stays
 *   unauthorized, which is fail-closed (both limiters ON, refused-claim logged,
 *   and boot refused wherever the capability boot guard runs). Add an identity
 *   here only together with a suite that actually floods sign-in.
 *
 * An identity grants no capability by itself: the policy store reads
 * BETA_E2E_GLOBAL_CAPABILITIES only (createEnvCapabilityPolicyStore), and
 * assertE2EOverrideIdentity is inert while that variable is empty. Production
 * carries neither variable — both exist only inside buildLocalStackEnv, which
 * feeds compose.local.yml and nothing else.
 */
const LOCAL_STACK_EXECUTION_IDENTITY = {
  beta: 'local-playwright-beta',
  e2e: 'local-playwright-e2e',
  perf: '',
} as const satisfies Record<LocalStackMode, string>

export function localStackEnvironment(mode: LocalStackMode): Readonly<{
  E2E_WEB_CAPABILITY_OVERRIDE: string
  E2E_WEB_EXECUTION_IDENTITY: string
}> {
  return {
    // All modes resolve product capabilities through persisted tenant policy.
    E2E_WEB_CAPABILITY_OVERRIDE: '',
    E2E_WEB_EXECUTION_IDENTITY: LOCAL_STACK_EXECUTION_IDENTITY[mode],
  }
}
