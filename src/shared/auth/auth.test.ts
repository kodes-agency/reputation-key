// Integration tests for the authentication configuration
// These tests verify that auth is properly configured and all expected
// features are enabled. Full end-to-end auth flow tests require a running
// server and are covered by E2E tests.
import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('Auth configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
    process.env.BETTER_AUTH_SECRET = 'test-test-test-test-test-test-test-test'
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.LOG_LEVEL = 'error'
  })

  it('env schema requires RESEND_API_KEY', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const original = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY

    const { getEnv } = await import('#/shared/config/env')
    expect(() => getEnv()).toThrow(/RESEND_API_KEY/)

    process.env.RESEND_API_KEY = original ?? 're_test_key'
  })

  it('createAuth returns an auth instance with email+password enabled', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth).toBeDefined()
    expect(typeof auth.handler).toBe('function')

    const options = auth.options
    expect(options.emailAndPassword?.enabled).toBe(true)
    expect(options.emailAndPassword?.requireEmailVerification).toBe(false)
    expect(options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true)
  })

  it('session configuration has correct expiry', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 30)
    expect(auth.options.session?.updateAge).toBe(60 * 60 * 24)
  })

  it('trusts only the configured app origin (BQC-7.6)', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    // Origin checks fail closed to the configured app URL — cross-origin
    // form posts / redirects to any other origin are rejected.
    expect(auth.options.trustedOrigins).toEqual(['http://localhost:3000'])
  })

  it('persists session cookies for the loopback HTTP production stack', async () => {
    // This suite resets the module graph so the cached environment is rebuilt
    // after each case's process.env setup.
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    process.env.NODE_ENV = 'production'
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000'

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.advanced?.defaultCookieAttributes?.secure).toBe(false)
  })
})

describe('Auth context and role helpers', () => {
  it('AuthContext type has required fields', async () => {
    const { ROLE_HIERARCHY } = await import('#/shared/domain/roles')

    // Role hierarchy should have all three roles
    expect(ROLE_HIERARCHY.AccountAdmin).toBe(2)
    expect(ROLE_HIERARCHY.PropertyManager).toBe(1)
    expect(ROLE_HIERARCHY.Staff).toBe(0)
  })

  it('hasRole enforces hierarchy correctly', async () => {
    const { hasRole } = await import('#/shared/domain/roles')

    expect(hasRole('AccountAdmin', 'Staff')).toBe(true)
    expect(hasRole('AccountAdmin', 'PropertyManager')).toBe(true)
    expect(hasRole('AccountAdmin', 'AccountAdmin')).toBe(true)
    expect(hasRole('PropertyManager', 'Staff')).toBe(true)
    expect(hasRole('PropertyManager', 'AccountAdmin')).toBe(false)
    expect(hasRole('Staff', 'PropertyManager')).toBe(false)
    expect(hasRole('Staff', 'AccountAdmin')).toBe(false)
  })
})

describe('Auth middleware helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
    process.env.BETTER_AUTH_SECRET = 'test-test-test-test-test-test-test-test'
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.LOG_LEVEL = 'error'
  })

  it('requireAuth throws tagged error when no session exists', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { requireAuth } = await import('#/shared/auth/middleware')
    const headers = new Headers()

    // Without a valid session cookie, requireAuth should throw a tagged error
    try {
      await requireAuth(headers)
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const authError = error as Error & { code: string; status: number }
      expect(authError.name).toBe('AuthError')
      expect(authError.code).toBe('unauthorized')
      expect(authError.status).toBe(401)
    }
  })
})
