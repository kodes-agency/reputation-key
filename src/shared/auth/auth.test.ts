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

  it('enables credentials and disables runtime custom roles', async () => {
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

    const organizationPlugin = auth.options.plugins?.find(
      (plugin) => plugin.id === 'organization',
    ) as
      | Readonly<{
          options?: Readonly<{
            dynamicAccessControl?: Readonly<{ enabled?: boolean }>
          }>
        }>
      | undefined
    expect(organizationPlugin?.options?.dynamicAccessControl?.enabled).toBe(false)
  })

  it('leaves sessions and verification of an invited sign-up to the app', async () => {
    // Invitation-bound registration is the only sign-up caller. Consuming the
    // invitation verifies the address, and registration then signs in
    // explicitly — so Better Auth neither mails a second verification link
    // nor opens a session of its own, in every environment alike.
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.emailAndPassword?.autoSignIn).toBe(false)
    expect(auth.options.emailVerification?.sendOnSignUp).toBe(false)
    // Recovery still needs the sender: the unverified-login "send a new link"
    // path and Better Auth's own verification routes.
    expect(auth.options.emailVerification?.sendVerificationEmail).toEqual(
      expect.any(Function),
    )
    expect(auth.options.emailAndPassword?.onPasswordReset).toEqual(expect.any(Function))
  })

  it('registers no organization-plugin invitation mailer', async () => {
    // Invitations are app-owned (invite-member / resend-invitation send the
    // mail); raw invite-member is blocked, so a plugin mailer would be dead
    // code drifting from the real email contract.
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    const { createAuth } = await import('#/shared/auth/auth')
    const organizationPlugin = createAuth().options.plugins?.find(
      (plugin) => plugin.id === 'organization',
    ) as Readonly<{ options?: Readonly<{ sendInvitationEmail?: unknown }> }> | undefined

    expect(organizationPlugin?.options?.sendInvitationEmail).toBeUndefined()
  })

  it('a password reset verifies an unverified address, and only that user', async () => {
    const { markEmailVerifiedOnPasswordReset } = await import('#/shared/auth/auth')
    const query = vi.fn().mockResolvedValue({ rowCount: 1 })
    const logger = { error: vi.fn() }

    await markEmailVerifiedOnPasswordReset(
      { query },
      logger,
    )({
      user: { id: 'user-reset-1' },
    })

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/UPDATE "user" SET "emailVerified" = true/)
    expect(sql).toMatch(/WHERE id = \$1 AND "emailVerified" = false/)
    expect(params).toEqual(['user-reset-1'])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('a failed verification write cannot fail the reset, and is logged by user id only', async () => {
    // Better Auth awaits this hook after the password update and BEFORE it
    // revokes the user's sessions. A throw here would spend the token, change
    // the password and leave every old session — a stolen one included —
    // alive. Verification is best-effort; resend-verification still recovers.
    const { markEmailVerifiedOnPasswordReset } = await import('#/shared/auth/auth')
    const failure = new Error('canceling statement due to statement timeout')
    const query = vi.fn().mockRejectedValue(failure)
    const logger = { error: vi.fn() }
    // Better Auth hands the hook its whole user row, address included.
    const user = { id: 'user-reset-2', email: 'reset-2@example.test' }

    await expect(
      markEmailVerifiedOnPasswordReset({ query }, logger)({ user }),
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [fields, message] = logger.error.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ]
    expect(fields).toEqual({ userId: 'user-reset-2', error: failure })
    expect(message).toMatch(/auth\.password_reset_verify_failed/)
    expect(JSON.stringify(fields)).not.toContain('reset-2@example.test')
  })

  it('keeps verification tokens valid for the 24-hour email promise', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.emailVerification?.expiresIn).toBe(60 * 60 * 24)
  })

  it('session configuration has correct expiry', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 30)
    expect(auth.options.session?.updateAge).toBe(60 * 60 * 24)
    expect(auth.options.session?.cookieCache?.enabled).toBe(false)
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

  it('refuses an HTTP auth origin in production', async () => {
    // This suite resets the module graph so the cached environment is rebuilt
    // after each case's process.env setup.
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    process.env.NODE_ENV = 'production'
    // A ROUTABLE http origin. Loopback is covered separately below, and a
    // hostname that merely ends in something loopback-shaped is not loopback.
    process.env.BETTER_AUTH_URL = 'http://app.reputationkey.app'

    const { createAuth } = await import('#/shared/auth/auth')
    expect(() => createAuth()).toThrow(/BETTER_AUTH_URL.*HTTPS|HTTPS.*BETTER_AUTH_URL/i)
  })

  it('allows a loopback HTTP origin in production, without the Secure attribute', async () => {
    // The local Compose stack runs the production images against
    // http://127.0.0.1:3000; traffic that never leaves the machine has no
    // plaintext transport to protect. The cookie must still tell the truth
    // about that: `Secure` stays off, because the origin is not https.
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    process.env.NODE_ENV = 'production'
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000'

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.advanced?.defaultCookieAttributes?.secure).toBe(false)
  })

  it('marks auth cookies Secure for a production HTTPS origin', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    process.env.NODE_ENV = 'production'
    process.env.BETTER_AUTH_URL = 'https://repkey.example'

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()

    expect(auth.options.advanced?.defaultCookieAttributes?.secure).toBe(true)
  })

  it('uses the parsed verification policy for invitation acceptance', async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    const { getEnv, resetEnv } = await import('#/shared/config/env')
    resetEnv()
    expect(getEnv().EMAIL_VERIFICATION_REQUIRED).toBe(true)

    // Reproduce a raw-env/config split after the policy has been parsed and
    // cached. Every Better Auth surface must use the same parsed value.
    delete process.env.EMAIL_VERIFICATION_REQUIRED

    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()
    const organizationPlugin = auth.options.plugins?.find(
      (plugin) => plugin.id === 'organization',
    ) as
      | Readonly<{
          options?: Readonly<{ requireEmailVerificationOnInvitation?: boolean }>
        }>
      | undefined

    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(true)
    expect(organizationPlugin?.options?.requireEmailVerificationOnInvitation).toBe(true)
  })

  it('fails closed before raw Better Auth membership and invitation lifecycle writes', async () => {
    const { resetEnv } = await import('#/shared/config/env')
    resetEnv()
    const { createAuth } = await import('#/shared/auth/auth')
    const auth = createAuth()
    const organizationPlugin = auth.options.plugins?.find(
      (plugin) => plugin.id === 'organization',
    ) as
      | Readonly<{
          options?: Readonly<{
            organizationHooks?: Readonly<{
              beforeAcceptInvitation?: (input: unknown) => Promise<void>
              beforeRemoveMember?: (input: unknown) => Promise<void>
              beforeUpdateMemberRole?: (input: unknown) => Promise<void>
              beforeDeleteOrganization?: (input: unknown) => Promise<void>
            }>
          }>
        }>
      | undefined
    const hooks = organizationPlugin?.options?.organizationHooks

    for (const hook of [
      hooks?.beforeAcceptInvitation,
      hooks?.beforeRemoveMember,
      hooks?.beforeUpdateMemberRole,
      hooks?.beforeDeleteOrganization,
    ]) {
      expect(hook).toEqual(expect.any(Function))
      await expect(hook?.({})).rejects.toThrow(/app-owned Identity command/i)
    }
  })
})

describe('Auth context and role helpers', () => {
  it('AuthContext type has required fields', async () => {
    const { ROLE_HIERARCHY } = await import('#/shared/domain/roles')

    // Role hierarchy should have all three roles
    expect(ROLE_HIERARCHY.AccountAdmin).toBe(2)
    expect(ROLE_HIERARCHY.PropertyManager).toBe(1)
    expect(ROLE_HIERARCHY.Member).toBe(0)
  })

  it('hasRole enforces hierarchy correctly', async () => {
    const { hasRole } = await import('#/shared/domain/roles')

    expect(hasRole('AccountAdmin', 'Member')).toBe(true)
    expect(hasRole('AccountAdmin', 'PropertyManager')).toBe(true)
    expect(hasRole('AccountAdmin', 'AccountAdmin')).toBe(true)
    expect(hasRole('PropertyManager', 'Member')).toBe(true)
    expect(hasRole('PropertyManager', 'AccountAdmin')).toBe(false)
    expect(hasRole('Member', 'PropertyManager')).toBe(false)
    expect(hasRole('Member', 'AccountAdmin')).toBe(false)
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
