// The test-only rate-limit hatch is refused in a deployed process.
//
// BETA_E2E_EXECUTION_IDENTITY is free text that authorizes the test-only hatch
// (E2E=1 stands both auth brute-force limiters down). The Playwright stack sets
// the hatch and its identity together (compose.local.yml), so a copy of that
// stack's variables onto a deployed service carried its own authorization.
// Railway injects RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID into every
// deployment and nothing local or in CI sets them, so their presence refuses
// the hatch, whatever identity is claimed.
//
// Proven here: the primitives and the worker's boot guard. The two auth
// limiter call sites are proven beside their own cases
// (e2e-rate-limit-hatch.test.ts, src/routes/api/auth/-$.test.ts).

import { afterEach, describe, expect, it } from 'vitest'
import {
  assertE2ERateLimitBypassIdentity,
  isE2ERateLimitBypassAuthorized,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from './beta-capabilities'
import { runCapabilityBootGuard } from './capability-boot-guard'

const IDENTITY = 'local-playwright-e2e'

/** The Playwright stack's web service: the hatch and its identity. */
const E2E_STACK: CapabilityPolicyEnv = {
  NODE_ENV: 'production',
  E2E: '1',
  BETA_E2E_EXECUTION_IDENTITY: IDENTITY,
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

describe('the test-only rate-limit hatch in a deployed process', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('still authorizes the Playwright stack, which carries no Railway id', () => {
    expect(isE2ERateLimitBypassAuthorized(E2E_STACK)).toBe(true)
    expect(() => assertE2ERateLimitBypassIdentity(E2E_STACK)).not.toThrow()
  })

  it.each(DEPLOYED_SHAPES)('keeps both auth limiters on with %s', (_label, railway) => {
    expect(isE2ERateLimitBypassAuthorized({ ...E2E_STACK, ...railway })).toBe(false)
  })

  it.each(DEPLOYED_SHAPES)('refuses the startup assertion with %s', (_label, railway) => {
    expect(() => assertE2ERateLimitBypassIdentity({ ...E2E_STACK, ...railway })).toThrow(
      /E2E.*refused on Railway/,
    )
  })

  it('refuses the worker boot guard before anything is logged or installed', () => {
    const entries: Array<{ obj: unknown; msg: string }> = []
    const logger = { info: (obj: unknown, msg: string) => entries.push({ obj, msg }) }

    expect(() =>
      runCapabilityBootGuard({ ...E2E_STACK, RAILWAY_PROJECT_ID: 'project-1' }, logger),
    ).toThrow(/refused on Railway/)
    expect(entries).toHaveLength(0)
  })

  it('boots a deployed process that sets no hatch', () => {
    const entries: Array<{ obj: unknown; msg: string }> = []
    const logger = { info: (obj: unknown, msg: string) => entries.push({ obj, msg }) }

    const manifest = runCapabilityBootGuard(
      {
        NODE_ENV: 'production',
        RAILWAY_PROJECT_ID: 'project-1',
        RAILWAY_ENVIRONMENT_ID: 'environment-1',
      },
      logger,
    )

    expect(manifest.authRateLimitBypass).toBe(false)
    expect(entries).toHaveLength(1)
  })
})
