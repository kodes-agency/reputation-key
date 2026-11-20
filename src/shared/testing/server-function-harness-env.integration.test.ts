// The server-function harness's environment and Redis options: settings the
// file names reach the container and every getEnv() reader, and rate limits
// count against the test Redis under the file's own key prefix.

import { getRequestHeaders } from '@tanstack/react-start/server'
import { describe, expect, it, vi } from 'vitest'
import { isOrganizationSuspended } from '#/shared/db/lifecycle/assert-organization-held'
import { getEnv } from '#/shared/config/env'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import { setupServerFunctionHarness } from './server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('./compiled-server-fns')).startServerBuild,
)

import { listMembers } from '#/contexts/identity/server/organizations.query'

const SUSPENDED = 'org-harness-env-suspended'

const harness = setupServerFunctionHarness({
  env: {
    TRUSTED_PROXY_MODE: 'xff',
    TRUSTED_PROXY_COUNT: '1',
    BETA_SUSPENDED_ORGS: SUSPENDED,
    CONTACT_REQUESTS_ENABLED: 'true',
    CONTACT_REQUEST_ENCRYPTION_KEY: 'ab'.repeat(32),
  },
  redis: true,
})

const LIMIT = { maxRequests: 2, windowSeconds: 60 }

describe('env', () => {
  it('parses the file’s settings as the app does, for the container and getEnv()', () => {
    expect(getEnv()).toMatchObject({
      TRUSTED_PROXY_MODE: 'xff',
      TRUSTED_PROXY_COUNT: 1,
      CONTACT_REQUESTS_ENABLED: true,
    })
  })

  it('builds the container’s execution policy from them', async () => {
    const suspended = await harness.seedOrganization({ id: SUSPENDED })
    const active = await harness.seedOrganization()
    const paused = await harness.seedMember(suspended, 'AccountAdmin')
    const admin = await harness.seedMember(active, 'AccountAdmin')

    await expect(harness.callAs(paused, () => listMembers())).rejects.toMatchObject({
      code: 'org_suspended',
    })
    await expect(harness.callAs(admin, () => listMembers())).resolves.toMatchObject({
      requestingRole: 'AccountAdmin',
    })
  })

  it('reaches the request-time readers', async () => {
    const ip = await harness.callAs(
      null,
      async () => clientIpFromHeaders(getRequestHeaders()),
      { headers: { 'x-forwarded-for': '198.51.100.4, 203.0.113.9' } },
    )

    expect(ip).toBe('203.0.113.9')
    expect(isOrganizationSuspended(SUSPENDED)).toBe(true)
  })
})

describe('redis', () => {
  it('counts rate limits, so the third call in the window is refused', async () => {
    const redis = harness.redis()
    if (!redis) return
    const { rateLimiter } = harness.container()

    const results = [
      await rateLimiter.check('harness:limit', LIMIT),
      await rateLimiter.check('harness:limit', LIMIT),
      await rateLimiter.check('harness:limit', LIMIT),
    ]

    expect(results.map((result) => result.allowed)).toEqual([true, true, false])
    expect(await redis.exists('ratelimit:public:harness:limit')).toBe(1)
  })

  it('starts each test with the allowance back', async () => {
    if (!harness.redis()) return

    const result = await harness.container().rateLimiter.check('harness:limit', LIMIT)

    expect(result).toMatchObject({ allowed: true, remaining: 1 })
  })
})
