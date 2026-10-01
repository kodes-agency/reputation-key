// Registration and sign-in server functions at the handler boundary:
//   - signInUser tells an unverified address apart from bad credentials;
//   - registerMember signs the new member in, and says when it could not;
//   - resendVerificationEmail is rate-limited per IP and per address and
//     answers the same whatever happened;
//   - listUserInvitations offers only invitations that can still be accepted.

import { APIError } from 'better-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { identityError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  registerInvitedUser: vi.fn(),
  signInEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
  rateLimitCheck: vi.fn(),
  setResponseHeader: vi.fn(),
  requireAuth: vi.fn(),
  listUserInvitations: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { registerInvitedUser: mocks.registerInvitedUser },
    },
    identityPort: { listUserInvitations: mocks.listUserInvitations },
    identityRequestSecurity: {
      invitationRateLimitHmacSecret: 'test-invitation-rate-limit-secret',
    },
    rateLimiter: { check: mocks.rateLimitCheck },
    logger: mocks.logger,
    clock: () => new Date('2026-09-30T12:00:00.000Z'),
  }),
}))
vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({
    api: {
      signInEmail: mocks.signInEmail,
      sendVerificationEmail: mocks.sendVerificationEmail,
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(
    async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  ),
}))
vi.mock('#/shared/security/client-ip', () => ({
  clientIpFromHeaders: () => '203.0.113.9',
}))
vi.mock('#/shared/auth/middleware', () => ({
  requireAuth: mocks.requireAuth,
}))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  listUserInvitationsHandler,
  registerMemberHandler,
  resendVerificationEmailHandler,
  signInUser,
} from './organizations.registration'

const signedInHeaders = () => {
  const headers = new Headers()
  headers.append('set-cookie', 'better-auth.session_token=token; Path=/; HttpOnly')
  headers.append('set-cookie', 'better-auth.session_data=data; Path=/; HttpOnly')
  return headers
}

const REGISTRATION = {
  invitationId: 'inv-join-1',
  name: 'New Manager',
  email: 'new.manager@example.com',
  password: 'Password123!',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rateLimitCheck.mockResolvedValue({ allowed: true })
  mocks.signInEmail.mockResolvedValue({ headers: signedInHeaders() })
  mocks.sendVerificationEmail.mockResolvedValue({ status: true })
})

describe('signInUser', () => {
  it('forwards both session cookies from one sign-in', async () => {
    await withStartContext(() =>
      signInUser({ data: { email: 'a@example.com', password: 'secret-1' } }),
    )

    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: 'a@example.com', password: 'secret-1' },
        returnHeaders: true,
      }),
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Set-Cookie', [
      'better-auth.session_token=token; Path=/; HttpOnly',
      'better-auth.session_data=data; Path=/; HttpOnly',
    ])
  })

  it('reports an unverified address as 403 email_not_verified', async () => {
    mocks.signInEmail.mockRejectedValue(
      APIError.from('FORBIDDEN', {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email not verified',
      }),
    )

    await expect(
      withStartContext(() =>
        signInUser({ data: { email: 'a@example.com', password: 'secret-1' } }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'email_not_verified',
      status: 403,
      message: 'Verify your email before signing in.',
    })
  })

  it('keeps every other refusal a 401 invalid_credentials', async () => {
    mocks.signInEmail.mockRejectedValue(
      APIError.from('UNAUTHORIZED', {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      }),
    )

    await expect(
      withStartContext(() =>
        signInUser({ data: { email: 'a@example.com', password: 'wrong-1' } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 })
  })

  it('reports a provider outage as server_error', async () => {
    mocks.signInEmail.mockRejectedValue(
      Object.assign(new Error('database down'), { statusCode: 503 }),
    )

    await expect(
      withStartContext(() =>
        signInUser({ data: { email: 'a@example.com', password: 'secret-1' } }),
      ),
    ).rejects.toMatchObject({ code: 'server_error', status: 503 })
  })
})

describe('registerMember', () => {
  it('signs the new member in once the invitation is consumed', async () => {
    mocks.registerInvitedUser.mockResolvedValue({ organizationId: 'org-1' })

    await expect(
      withStartContext(() => registerMemberHandler({ data: REGISTRATION })),
    ).resolves.toEqual({ signedIn: true })

    expect(mocks.registerInvitedUser).toHaveBeenCalledWith(REGISTRATION)
    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: REGISTRATION.email, password: REGISTRATION.password },
      }),
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledTimes(1)
  })

  it('still reports the created account when the sign-in after it fails', async () => {
    mocks.registerInvitedUser.mockResolvedValue({ organizationId: 'org-1' })
    mocks.signInEmail.mockRejectedValue(new Error('sign-in unavailable'))

    await expect(
      withStartContext(() => registerMemberHandler({ data: REGISTRATION })),
    ).resolves.toEqual({ signedIn: false })
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(REGISTRATION.email)
  })

  it('maps a refused registration and does not sign in', async () => {
    mocks.registerInvitedUser.mockRejectedValue(
      identityError(
        'account_exists',
        'An account already exists for this email. Sign in, then open your invitation link again.',
      ),
    )

    await expect(
      withStartContext(() => registerMemberHandler({ data: REGISTRATION })),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'account_exists',
      status: 409,
    })
    expect(mocks.signInEmail).not.toHaveBeenCalled()
  })
})

describe('resendVerificationEmail', () => {
  const send = (email = 'unverified@example.com') =>
    withStartContext(() => resendVerificationEmailHandler({ data: { email } }))

  it('asks Better Auth for a fresh link that returns to sign-in', async () => {
    await expect(send()).resolves.toEqual({ sent: true })

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      body: { email: 'unverified@example.com', callbackURL: '/login' },
    })
  })

  it('limits each IP and each address, keying the address by a pseudonym', async () => {
    await send('Unverified@Example.com')

    const keys = mocks.rateLimitCheck.mock.calls.map(([key]) => key as string)
    expect(mocks.rateLimitCheck.mock.calls.map(([, limit]) => limit)).toEqual([
      { maxRequests: 5, windowSeconds: 3600 },
      { maxRequests: 3, windowSeconds: 3600 },
    ])
    expect(keys[0]).toBe('identity:verify-resend:ip:203.0.113.9')
    expect(keys[1]).toMatch(/^identity:verify-resend:email:[0-9a-f]{64}$/)
    expect(keys.join(' ')).not.toMatch(/unverified/i)

    await send('unverified@example.com')
    expect(mocks.rateLimitCheck.mock.calls[3]?.[0]).toBe(keys[1])
  })

  it.each([
    ['the IP', [{ allowed: false }]],
    ['the address', [{ allowed: true }, { allowed: false }]],
  ])(
    'refuses with 429 once %s is over its limit, sending nothing',
    async (_name, results) => {
      for (const result of results) mocks.rateLimitCheck.mockResolvedValueOnce(result)

      await expect(send()).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
      expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
    },
  )

  it('answers the same when the send fails, and logs it without the address', async () => {
    mocks.sendVerificationEmail.mockRejectedValue(
      new Error('Resend rejected unverified@example.com'),
    )

    await expect(send()).resolves.toEqual({ sent: true })
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.logger.warn.mock.calls[0]?.[0])).not.toContain(
      'unverified@example.com',
    )
  })
})

describe('listUserInvitations', () => {
  it('offers only invitations that can still be accepted', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
    const base = {
      email: 'a@example.com',
      role: 'PropertyManager',
      rawRole: 'admin',
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      propertyIds: [],
      organizationName: 'Riverside',
    }
    mocks.listUserInvitations.mockResolvedValue([
      {
        ...base,
        id: 'inv-live',
        status: 'pending',
        expiresAt: new Date('2026-10-01T12:00:00.000Z'),
      },
      {
        ...base,
        id: 'inv-lapsed',
        status: 'pending',
        expiresAt: new Date('2026-09-29T12:00:00.000Z'),
      },
      {
        ...base,
        id: 'inv-expired',
        status: 'expired',
        expiresAt: new Date('2026-10-01T12:00:00.000Z'),
      },
    ])

    const result = await withStartContext(() => listUserInvitationsHandler())

    expect(result.invitations.map((inv) => inv.id)).toEqual(['inv-live'])
  })
})
