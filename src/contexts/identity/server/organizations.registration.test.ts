// Provider faults the real sign-in and mail stack cannot be made to produce on
// demand; every other outcome is in organizations.registration.integration.test.ts:
//   - a provider outage on sign-in is a 503 server_error;
//   - registerMember reports the created account when the sign-in after it fails;
//   - resendVerificationEmail answers the same when the send fails.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'

const mocks = vi.hoisted(() => ({
  registerInvitedUser: vi.fn(),
  signInEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
  rateLimitCheck: vi.fn(),
  setResponseHeader: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { registerInvitedUser: mocks.registerInvitedUser },
    },
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
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  registerMemberHandler,
  resendVerificationEmailHandler,
  signInUser,
} from './organizations.registration'

const REGISTRATION = {
  invitationId: 'inv-join-1',
  name: 'New Manager',
  email: 'new.manager@example.com',
  password: 'Password123!',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rateLimitCheck.mockResolvedValue({ allowed: true })
  mocks.sendVerificationEmail.mockResolvedValue({ status: true })
})

describe('signInUser', () => {
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
  it('still reports the created account when the sign-in after it fails', async () => {
    mocks.registerInvitedUser.mockResolvedValue({ organizationId: 'org-1' })
    mocks.signInEmail.mockRejectedValue(new Error('sign-in unavailable'))

    await expect(
      withStartContext(() => registerMemberHandler({ data: REGISTRATION })),
    ).resolves.toEqual({ signedIn: false })
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(REGISTRATION.email)
  })
})

describe('resendVerificationEmail', () => {
  it('answers the same when the send fails, and logs it without the address', async () => {
    mocks.sendVerificationEmail.mockRejectedValue(
      new Error('Resend rejected unverified@example.com'),
    )

    await expect(
      withStartContext(() =>
        resendVerificationEmailHandler({ data: { email: 'unverified@example.com' } }),
      ),
    ).resolves.toEqual({ sent: true })
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.logger.warn.mock.calls[0]?.[0])).not.toContain(
      'unverified@example.com',
    )
  })
})
