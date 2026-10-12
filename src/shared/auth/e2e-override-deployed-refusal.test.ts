// The test-only overrides are refused in a deployed process.
//
// BETA_E2E_EXECUTION_IDENTITY is free text that authorizes the two test-only
// hatches (E2E=1 stands both auth brute-force limiters down;
// BETA_E2E_GLOBAL_CAPABILITIES opens controlled-beta capabilities to every
// Organization). The Playwright stack sets the hatch and its identity together
// (compose.local.yml), so a copy of that stack's variables onto a deployed
// service carried its own authorization. Railway injects RAILWAY_PROJECT_ID and
// RAILWAY_ENVIRONMENT_ID into every deployment and nothing local or in CI sets
// them, so their presence refuses every hatch, whatever identity is claimed.
//
// Proven here: the two primitives, the policy store the web process builds
// without a boot guard, the worker's boot guard, and the lazy store fallback.
// The two auth limiter call sites are proven beside their own cases
// (e2e-rate-limit-hatch.test.ts, src/routes/api/auth/-$.test.ts).

import { afterEach, describe, expect, it } from 'vitest'
import { buildCapabilityPolicyHandle } from '#/contexts/identity/infrastructure/policy-store-init'
import type { Database } from '#/shared/db'
import {
  assertE2EOverrideIdentity,
  assertE2ERateLimitBypassIdentity,
  checkGlobalCapability,
  createEnvCapabilityPolicyStore,
  isE2ERateLimitBypassAuthorized,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from './beta-capabilities'
import { runCapabilityBootGuard } from './capability-boot-guard'

const IDENTITY = 'local-playwright-e2e'
const OVERRIDE = 'goal.use,notification.send_email'

/** The Playwright stack's web service: both hatches and their identity. */
const E2E_STACK: CapabilityPolicyEnv = {
  NODE_ENV: 'production',
  E2E: '1',
  BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
  BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
}

/** Either Railway identifier marks a deployed process. */
const DEPLOYED_SHAPES: ReadonlyArray<readonly [string, CapabilityPolicyEnv]> = [
  ['a Railway project id', { RAILWAY_PROJECT_ID: 'project-1' }],
  ['a Railway environment id', { RAILWAY_ENVIRONMENT_ID: 'environment-1' }],
  // A value nobody can vouch for reads as deployed: the doubtful case refuses.
  ['a blank Railway project id', { RAILWAY_PROJECT_ID: ' ' }],
  [
    'both Railway ids under NODE_ENV=test',
    {
      NODE_ENV: 'test',
      RAILWAY_PROJECT_ID: 'project-1',
      RAILWAY_ENVIRONMENT_ID: 'environment-1',
    },
  ],
]

describe('test-only overrides in a deployed process', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('still authorizes the Playwright stack, which carries no Railway id', () => {
    expect(isE2ERateLimitBypassAuthorized(E2E_STACK)).toBe(true)
    expect(
      createEnvCapabilityPolicyStore(E2E_STACK).isCapabilityGloballyEnabled('goal.use'),
    ).toBe(true)
    expect(() => assertE2EOverrideIdentity(E2E_STACK)).not.toThrow()
    expect(() => assertE2ERateLimitBypassIdentity(E2E_STACK)).not.toThrow()
  })

  it.each(DEPLOYED_SHAPES)('keeps both auth limiters on with %s', (_label, railway) => {
    expect(isE2ERateLimitBypassAuthorized({ ...E2E_STACK, ...railway })).toBe(false)
  })

  it.each(DEPLOYED_SHAPES)(
    'builds a policy store that ignores the capability override with %s',
    (_label, railway) => {
      const store = createEnvCapabilityPolicyStore({ ...E2E_STACK, ...railway })

      expect(store.isCapabilityGloballyEnabled('goal.use')).toBe(false)
      expect(store.isCapabilityGloballyEnabled('notification.send_email')).toBe(false)
      // Core capabilities and the allowlist are untouched by the refusal.
      expect(store.isCapabilityGloballyEnabled('inbox.use')).toBe(true)
      expect(store.isOrgAllowlisted('org-1', 'goal.use')).toBe(false)
    },
  )

  it.each(DEPLOYED_SHAPES)(
    'refuses both startup assertions with %s',
    (_label, railway) => {
      const env = { ...E2E_STACK, ...railway }

      expect(() => assertE2EOverrideIdentity(env)).toThrow(
        /BETA_E2E_GLOBAL_CAPABILITIES.*refused on Railway/,
      )
      expect(() => assertE2ERateLimitBypassIdentity(env)).toThrow(
        /E2E.*refused on Railway/,
      )
    },
  )

  it('refuses the worker boot guard before anything is logged or installed', () => {
    const entries: Array<{ obj: unknown; msg: string }> = []
    const logger = { info: (obj: unknown, msg: string) => entries.push({ obj, msg }) }

    expect(() =>
      runCapabilityBootGuard({ ...E2E_STACK, RAILWAY_PROJECT_ID: 'project-1' }, logger),
    ).toThrow(/refused on Railway/)
    expect(entries).toHaveLength(0)
  })

  it('boots a deployed process that sets none of the overrides', () => {
    const entries: Array<{ obj: unknown; msg: string }> = []
    const logger = { info: (obj: unknown, msg: string) => entries.push({ obj, msg }) }

    const manifest = runCapabilityBootGuard(
      {
        NODE_ENV: 'production',
        RAILWAY_PROJECT_ID: 'project-1',
        RAILWAY_ENVIRONMENT_ID: 'environment-1',
        BETA_ALLOWLIST_ORGS: '*',
      },
      logger,
    )

    expect(manifest.authRateLimitBypass).toBe(false)
    expect(manifest.e2eGlobalOverrides).toEqual([])
    expect(entries).toHaveLength(1)
  })

  describe('the store the web process builds (no boot guard runs there)', () => {
    // The handle builder reads no row until a grant or consent is looked up.
    const db = {} as Database
    const build = (env: CapabilityPolicyEnv) => {
      const warnings: Array<{ fields: unknown; message: string }> = []
      const handle = buildCapabilityPolicyHandle({
        db,
        env,
        clock: () => new Date('2026-10-12T00:00:00Z'),
        logger: { warn: (fields, message) => warnings.push({ fields, message }) },
      })
      return { warnings, store: handle.capabilityPolicyStore }
    }

    it('says so once when it drops the capability override', () => {
      const { warnings, store } = build({ ...E2E_STACK, RAILWAY_PROJECT_ID: 'project-1' })

      expect(store.isCapabilityGloballyEnabled('goal.use')).toBe(false)
      expect(warnings).toEqual([
        {
          fields: { variable: 'BETA_E2E_GLOBAL_CAPABILITIES' },
          message:
            'capability.e2e_override_refused: BETA_E2E_GLOBAL_CAPABILITIES is set on a deployed process and is IGNORED — unset it on the deployed service',
        },
      ])
    })

    it('stays quiet where the override is honoured, and where none is set', () => {
      const playwright = build(E2E_STACK)
      const deployed = build({ NODE_ENV: 'production', RAILWAY_PROJECT_ID: 'project-1' })

      expect(playwright.store.isCapabilityGloballyEnabled('goal.use')).toBe(true)
      expect(playwright.warnings).toEqual([])
      expect(deployed.store.isCapabilityGloballyEnabled('goal.use')).toBe(false)
      expect(deployed.warnings).toEqual([])
    })
  })

  describe('lazy store fallback (a process with no boot guard)', () => {
    const ENV_KEYS = [
      'NODE_ENV',
      'BETA_E2E_GLOBAL_CAPABILITIES',
      'BETA_E2E_EXECUTION_IDENTITY',
      'RAILWAY_PROJECT_ID',
    ] as const
    const saved = new Map<string, string | undefined>()

    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      saved.clear()
    })

    function setProcessEnv(patch: Record<(typeof ENV_KEYS)[number], string>): void {
      for (const key of ENV_KEYS) {
        saved.set(key, process.env[key])
        process.env[key] = patch[key]
      }
    }

    it('throws on the first capability check instead of opening the capability', () => {
      setProcessEnv({
        NODE_ENV: 'production',
        BETA_E2E_GLOBAL_CAPABILITIES: OVERRIDE,
        BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
        RAILWAY_PROJECT_ID: 'project-1',
      })
      resetCapabilityPolicyStore()

      expect(() => checkGlobalCapability('goal.use')).toThrow(/refused on Railway/)
    })
  })
})
