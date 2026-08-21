// Review §5.1 — E2E is a test-only hatch that stands BOTH auth brute-force
// layers down. It used to be read as bare truthiness (`!process.env.E2E`) at
// two call sites, was absent from the zod env schema, and had no boot guard and
// no log line — so one stray env var opened credential stuffing against a
// closed-beta multi-tenant deployment, silently.
//
// Invariants proven here (the better-auth layer + the startup refusal; the
// catch-all route layer is proven in src/routes/api/auth/-$.test.ts):
//   1. better-auth rate limiting is ENABLED when E2E is unset.
//   2. A near-miss value ('true') refuses boot at the env schema instead of
//      silently disabling rate limiting.
//   3. E2E=1 without a test/CI execution identity keeps rate limiting ENABLED
//      and logs the refusal; with an identity it stands down (the posture the
//      Playwright stack depends on).
//   4. The boot guard refuses startup when E2E is set outside that identity,
//      and the boot manifest records the effective posture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertE2ERateLimitBypassIdentity,
  claimsE2ERateLimitBypass,
  isE2ERateLimitBypassAuthorized,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from './beta-capabilities'
import {
  buildCapabilityBootManifest,
  runCapabilityBootGuard,
} from './capability-boot-guard'

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }))

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: logs.warn,
    error: logs.error,
    fatal: vi.fn(),
  }),
}))

const IDENTITY = 'local-playwright-e2e'
const MANAGED = ['NODE_ENV', 'E2E', 'BETA_E2E_EXECUTION_IDENTITY'] as const
const ORIGINAL: Record<string, string | undefined> = {
  NODE_ENV: process.env.NODE_ENV,
  E2E: process.env.E2E,
  BETA_E2E_EXECUTION_IDENTITY: process.env.BETA_E2E_EXECUTION_IDENTITY,
}
/**
 * Rebuild the module graph under a given process env. env.ts builds its zod
 * schema at module load (its production branches read process.env.NODE_ENV),
 * so a fresh graph — not just resetEnv() — is what makes NODE_ENV changes real.
 *
 * Dynamic import (not static) for exactly that reason: these cases exercise the
 * module-loading boundary.
 */
async function reloadWith(vars: Partial<Record<(typeof MANAGED)[number], string>>) {
  for (const key of MANAGED) {
    if (vars[key] === undefined) delete process.env[key]
    else process.env[key] = vars[key]
  }
  vi.resetModules()
  const env = await import('#/shared/config/env')
  env.resetEnv()
  return { ...env, ...(await import('#/shared/auth/auth')) }
}

describe('better-auth rate limiting (review §5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const key of MANAGED) {
      const value = ORIGINAL[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('is enabled when E2E is unset', async () => {
    const { createAuth } = await reloadWith({ NODE_ENV: 'test' })

    expect(createAuth().options.rateLimit?.enabled).toBe(true)
    expect(logs.warn).not.toHaveBeenCalled()
    expect(logs.error).not.toHaveBeenCalled()
  })

  it('refuses to boot on a near-miss E2E value instead of disabling limiting', async () => {
    const { getEnv } = await reloadWith({ NODE_ENV: 'development', E2E: 'true' })

    expect(() => getEnv()).toThrow(/E2E/)
  })

  it('stays enabled when E2E=1 carries no execution identity, and logs the refusal', async () => {
    const { createAuth } = await reloadWith({ NODE_ENV: 'development', E2E: '1' })

    expect(createAuth().options.rateLimit?.enabled).toBe(true)
    expect(logs.error).toHaveBeenCalledTimes(1)
    expect(logs.error.mock.calls[0]?.[1]).toMatch(/auth\.rate_limit_bypass_refused/)
  })

  it('stands down for E2E=1 with an execution identity (the e2e stack posture)', async () => {
    const { createAuth } = await reloadWith({
      NODE_ENV: 'development',
      E2E: '1',
      BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
    })

    expect(createAuth().options.rateLimit?.enabled).toBe(false)
    expect(logs.warn.mock.calls[0]?.[1]).toMatch(/auth\.rate_limit_bypass_active/)
    expect(logs.error).not.toHaveBeenCalled()
  })
})

describe('E2E hatch authorization', () => {
  it('authorizes only the exact value plus an explicit identity', () => {
    expect(isE2ERateLimitBypassAuthorized({ E2E: '1', NODE_ENV: 'test' })).toBe(true)
    expect(
      isE2ERateLimitBypassAuthorized({
        E2E: '1',
        NODE_ENV: 'production',
        BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
      }),
    ).toBe(true)
    // Right value, no identity — the production-mistake case.
    expect(isE2ERateLimitBypassAuthorized({ E2E: '1', NODE_ENV: 'production' })).toBe(
      false,
    )
    // Truthy near-misses that the old `!process.env.E2E` read accepted.
    for (const value of ['true', 'yes', '0', 'false', ' ']) {
      expect(isE2ERateLimitBypassAuthorized({ E2E: value, NODE_ENV: 'test' })).toBe(false)
    }
    expect(isE2ERateLimitBypassAuthorized({ NODE_ENV: 'test' })).toBe(false)
  })

  it('reports a claim for any non-empty value, so refusals can be logged', () => {
    expect(claimsE2ERateLimitBypass({ E2E: 'true' })).toBe(true)
    expect(claimsE2ERateLimitBypass({ E2E: ' ' })).toBe(false)
    expect(claimsE2ERateLimitBypass({})).toBe(false)
  })
})

describe('E2E hatch boot guard', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('refuses startup when E2E is set outside a test/CI execution identity', () => {
    const env: CapabilityPolicyEnv = { NODE_ENV: 'production', E2E: '1' }

    expect(() => assertE2ERateLimitBypassIdentity(env)).toThrow(/E2E/)
    expect(() =>
      assertE2ERateLimitBypassIdentity({ NODE_ENV: 'development', E2E: '1' }),
    ).toThrow(/execution identity/)
    // The shape a service inherits when E2E is granted without an authorized
    // identity — what compose.local.yml's x-app-environment anchor produced
    // for worker and web-locked before E2E was scoped to the web service.
    expect(() =>
      assertE2ERateLimitBypassIdentity({
        NODE_ENV: 'production',
        E2E: '1',
        BETA_E2E_EXECUTION_IDENTITY: '',
      }),
    ).toThrow(/E2E/)
  })

  it('boots with an authorized identity or no hatch at all', () => {
    expect(() =>
      assertE2ERateLimitBypassIdentity({ NODE_ENV: 'test', E2E: '1' }),
    ).not.toThrow()
    expect(() =>
      assertE2ERateLimitBypassIdentity({
        NODE_ENV: 'production',
        E2E: '1',
        BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
      }),
    ).not.toThrow()
    expect(() =>
      assertE2ERateLimitBypassIdentity({ NODE_ENV: 'production' }),
    ).not.toThrow()
  })

  it('refuses the whole boot guard — nothing is logged or initialized', () => {
    const entries: Array<{ obj: unknown; msg: string }> = []
    const logger = { info: (obj: unknown, msg: string) => entries.push({ obj, msg }) }

    expect(() =>
      runCapabilityBootGuard({ NODE_ENV: 'production', E2E: '1' }, logger),
    ).toThrow(/E2E/)
    expect(entries).toHaveLength(0)
  })

  it('boots the guard for the two real e2e-stack service shapes', () => {
    const entries: Array<{ obj: unknown; msg: string }> = []
    const logger = { info: (obj: unknown, msg: string) => entries.push({ obj, msg }) }

    // worker / web-locked: production, no hatch, no capability override.
    const worker = runCapabilityBootGuard(
      { NODE_ENV: 'production', BETA_E2E_EXECUTION_IDENTITY: '' },
      logger,
    )
    expect(worker.authRateLimitBypass).toBe(false)

    // web (:3000): the hatch, authorized by the stack's execution identity.
    const web = runCapabilityBootGuard(
      {
        NODE_ENV: 'production',
        E2E: '1',
        BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
        BETA_E2E_GLOBAL_CAPABILITIES: 'identity.register,organization.create',
      },
      logger,
    )
    expect(web.authRateLimitBypass).toBe(true)
    expect(entries).toHaveLength(2)
  })

  it('records the hatch posture in the boot manifest', () => {
    expect(
      buildCapabilityBootManifest({ NODE_ENV: 'production', E2E: '1' })
        .authRateLimitBypass,
    ).toBe(false)
    expect(
      buildCapabilityBootManifest({
        NODE_ENV: 'production',
        E2E: '1',
        BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
      }).authRateLimitBypass,
    ).toBe(true)
  })
})
