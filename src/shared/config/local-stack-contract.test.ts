import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  createEnvCapabilityPolicyStore,
  isE2ERateLimitBypassAuthorized,
} from '#/shared/auth/beta-capabilities'
import {
  LOCAL_E2E_EXECUTION_IDENTITY,
  LOCAL_E2E_OPERATOR_USER_ID,
  LOCAL_E2E_ORGANIZATION_ID,
} from './local-stack-contract'

/** The Organization scripts/seed-e2e-user.ts seeds as Org B. */
const LOCAL_E2E_LOCKED_ORGANIZATION_ID = 'e2e-locked-org-b'
import { localStackPlaywrightEnv } from '#/shared/testing/local-stack-playwright-env'

function webEnvironment() {
  return {
    NODE_ENV: 'test',
    E2E: '1',
    BETA_E2E_EXECUTION_IDENTITY: LOCAL_E2E_EXECUTION_IDENTITY,
    BETA_SUSPENDED_ORGS: LOCAL_E2E_LOCKED_ORGANIZATION_ID,
  } as const
}

describe('local stack contract', () => {
  it('keeps the committed environment aligned with the seeded stack identity', () => {
    const env = localStackPlaywrightEnv(resolve(process.cwd(), 'e2e/stack.env'))

    // Org B is the suspended Organization the cross-tenant journeys refuse.
    expect(env.BETA_SUSPENDED_ORGS).toBe(LOCAL_E2E_LOCKED_ORGANIZATION_ID)
    expect(env.BETA_ALLOWLIST_ORGS).toBeUndefined()
    expect(env.E2E_EXTERNAL_STACK).toBe('1')
    expect(env.QUEUE_REDIS_URL).toBe(env.REDIS_URL)
  })

  it('lists the seeded owner as the platform operator by account, not by address', () => {
    const env = localStackPlaywrightEnv(resolve(process.cwd(), 'e2e/stack.env'))

    // The console's principal is `user:<user id>` (ADR 0065); the seed creates
    // the owner with this id so the committed list can name it.
    expect(env.OPS_OPERATOR_IDENTITIES).toBe(`user:${LOCAL_E2E_OPERATOR_USER_ID}`)
  })

  it('runs every product capability for the seeded organization and none for the suspended one', () => {
    const store = createEnvCapabilityPolicyStore(webEnvironment())

    expect(store.isCapabilityKilled('portal.write')).toBe(false)
    expect(store.isCapabilityKilled('portal.upload')).toBe(false)
    expect(store.isOrgSuspended(LOCAL_E2E_ORGANIZATION_ID)).toBe(false)
    expect(store.isOrgSuspended(LOCAL_E2E_LOCKED_ORGANIZATION_ID)).toBe(true)
  })

  it('authorizes the auth rate-limit hatch', () => {
    expect(isE2ERateLimitBypassAuthorized(webEnvironment())).toBe(true)
  })
})
