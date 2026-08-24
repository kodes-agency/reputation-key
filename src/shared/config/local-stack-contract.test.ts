import { describe, expect, it } from 'vitest'
import {
  assertE2EOverrideIdentity,
  assertE2ERateLimitBypassIdentity,
  claimsE2ERateLimitBypass,
  createEnvCapabilityPolicyStore,
  isE2ERateLimitBypassAuthorized,
} from '#/shared/auth/beta-capabilities'
import {
  LOCAL_BETA_CAPABILITIES,
  LOCAL_E2E_BOOTSTRAP_CAPABILITIES,
  localStackEnvironment,
  type LocalStackMode,
} from './local-stack-contract'

/**
 * The environment compose.local.yml hands the `web` service of a local stack:
 * a production-mode app, the hatch claim hardcoded on the service
 * (compose.local.yml `E2E: '1'`), and the two contract values. Modelling it
 * here is what makes the claim/authorization pair provable without Docker.
 */
function webEnvironment(mode: LocalStackMode) {
  const contract = localStackEnvironment(mode)
  return {
    NODE_ENV: 'production',
    E2E: '1',
    BETA_E2E_EXECUTION_IDENTITY: contract.E2E_WEB_EXECUTION_IDENTITY,
    BETA_E2E_GLOBAL_CAPABILITIES: contract.E2E_WEB_CAPABILITY_OVERRIDE,
  }
}

describe('local beta stack contract', () => {
  it('allows the promoted cohort surfaces without enabling prohibited Google behaviors', () => {
    expect(LOCAL_BETA_CAPABILITIES).toEqual(
      expect.arrayContaining([
        'portal.read',
        'portal.write',
        'portal.public_read',
        'portal.guest_response',
        'portal.guest_text',
        'portal.guest_contact',
        'portal.guest_media',
        'team.use',
        'goal.use',
        'badge.use',
        'leaderboard.use',
        'notification.send_email',
        'property.import_gbp_v2',
        'property.read_gbp_performance',
      ]),
    )
    expect(LOCAL_BETA_CAPABILITIES).not.toEqual(
      expect.arrayContaining([
        'portal.upload',
        'gbp.reply.auto_publish',
        'gbp.ai.cross_property_summary',
        'gbp.review_solicitation_gamification',
      ]),
    )
  })

  it('limits the permissive E2E override to account bootstrap', () => {
    expect(LOCAL_E2E_BOOTSTRAP_CAPABILITIES).toEqual([
      'identity.register',
      'organization.create',
    ])
    expect(localStackEnvironment('e2e').E2E_WEB_CAPABILITY_OVERRIDE).toBe(
      LOCAL_E2E_BOOTSTRAP_CAPABILITIES.join(','),
    )
    // beta-acceptance exists to prove real capability gating, so beta resolves
    // every capability through persisted tenant policy. perf likewise.
    expect(localStackEnvironment('beta').E2E_WEB_CAPABILITY_OVERRIDE).toBe('')
    expect(localStackEnvironment('perf').E2E_WEB_CAPABILITY_OVERRIDE).toBe('')
  })

  it('authorizes the auth rate-limit hatch for every mode that floods sign-in', () => {
    // Both browser-suite modes authorize the claim compose makes on web, with
    // distinct identities so a boot log names the suite that stood the auth
    // brute-force limiters down.
    expect(localStackEnvironment('e2e').E2E_WEB_EXECUTION_IDENTITY).toBe(
      'local-playwright-e2e',
    )
    expect(localStackEnvironment('beta').E2E_WEB_EXECUTION_IDENTITY).toBe(
      'local-playwright-beta',
    )
    // perf drives no browser suite: its claim stays unauthorized (fail-closed).
    expect(localStackEnvironment('perf').E2E_WEB_EXECUTION_IDENTITY).toBe('')
  })

  it('keeps the rate-limit hatch and the capability override independent', () => {
    const beta = webEnvironment('beta')

    // beta authorizes the hatch it already claims — the limiters stand down.
    expect(claimsE2ERateLimitBypass(beta)).toBe(true)
    expect(isE2ERateLimitBypassAuthorized(beta)).toBe(true)
    expect(() => assertE2ERateLimitBypassIdentity(beta)).not.toThrow()

    // ...and gains no capability by holding an identity. Nothing but
    // BETA_E2E_GLOBAL_CAPABILITIES globally enables a non-core capability, so
    // the bootstrap pair stays off and the override guard stays inert.
    const betaStore = createEnvCapabilityPolicyStore(beta)
    for (const capability of LOCAL_E2E_BOOTSTRAP_CAPABILITIES) {
      expect(betaStore.isCapabilityGloballyEnabled(capability)).toBe(false)
    }
    expect(() => assertE2EOverrideIdentity(beta)).not.toThrow()

    // e2e is the only mode where the same identity also carries the override.
    const e2e = webEnvironment('e2e')
    expect(isE2ERateLimitBypassAuthorized(e2e)).toBe(true)
    const e2eStore = createEnvCapabilityPolicyStore(e2e)
    for (const capability of LOCAL_E2E_BOOTSTRAP_CAPABILITIES) {
      expect(e2eStore.isCapabilityGloballyEnabled(capability)).toBe(true)
    }

    // perf claims the hatch without an identity: refused, both limiters stay
    // ON, and the claim refuses boot wherever the capability guard runs.
    const perf = webEnvironment('perf')
    expect(claimsE2ERateLimitBypass(perf)).toBe(true)
    expect(isE2ERateLimitBypassAuthorized(perf)).toBe(false)
    expect(() => assertE2ERateLimitBypassIdentity(perf)).toThrow(/execution identity/)
  })
})
