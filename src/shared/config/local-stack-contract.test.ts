import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  assertE2EOverrideIdentity,
  createEnvCapabilityPolicyStore,
  isE2ERateLimitBypassAuthorized,
} from '#/shared/auth/beta-capabilities'
import {
  LOCAL_E2E_EXECUTION_IDENTITY,
  LOCAL_E2E_ORGANIZATION_ID,
} from './local-stack-contract'
import { localStackPlaywrightEnv } from '#/shared/testing/local-stack-playwright-env'

function webEnvironment() {
  return {
    NODE_ENV: 'test',
    E2E: '1',
    BETA_E2E_EXECUTION_IDENTITY: LOCAL_E2E_EXECUTION_IDENTITY,
    BETA_E2E_GLOBAL_CAPABILITIES: '',
    BETA_ALLOWLIST_ORGS: LOCAL_E2E_ORGANIZATION_ID,
  } as const
}

describe('local stack contract', () => {
  it('keeps the committed environment aligned with the seeded stack identity', () => {
    const env = localStackPlaywrightEnv(resolve(process.cwd(), 'e2e/stack.env'))

    expect(env.BETA_ALLOWLIST_ORGS).toBe(LOCAL_E2E_ORGANIZATION_ID)
    expect(env.E2E_EXTERNAL_STACK).toBe('1')
    expect(env.QUEUE_REDIS_URL).toBe(env.REDIS_URL)
  })

  it('allows non-core product capabilities only for the seeded organization', () => {
    const store = createEnvCapabilityPolicyStore(webEnvironment())

    expect(store.isOrgAllowlisted(LOCAL_E2E_ORGANIZATION_ID, 'portal.write')).toBe(true)
    expect(store.isOrgAllowlisted('another-org', 'portal.write')).toBe(false)
    expect(store.isOrgAllowlisted(LOCAL_E2E_ORGANIZATION_ID, 'portal.upload')).toBe(false)
  })

  it('does not use the process-wide E2E capability override', () => {
    const env = webEnvironment()
    expect(env.BETA_E2E_GLOBAL_CAPABILITIES).toBe('')
    expect(() => assertE2EOverrideIdentity(env)).not.toThrow()
  })

  it('authorizes the auth rate-limit hatch without granting capabilities globally', () => {
    const env = webEnvironment()
    const store = createEnvCapabilityPolicyStore(env)

    expect(isE2ERateLimitBypassAuthorized(env)).toBe(true)
    expect(store.isCapabilityGloballyEnabled('portal.write')).toBe(false)
  })
})
