import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { identityError } from '../domain/errors'

const NOW = new Date('2026-09-30T12:00:00.000Z')

const mocks = vi.hoisted(() => ({
  requirePlatformOperator: vi.fn(),
  enforceRateLimit: vi.fn(),
  listOrganizations: vi.fn(),
  provisionOrganization: vi.fn(),
  inviteAdmin: vi.fn(),
  resendInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  rateLimiter: { check: vi.fn() },
  setResponseHeader: vi.fn(),
}))

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  setResponseHeader: mocks.setResponseHeader,
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => NOW,
    logger: mocks.logger,
    rateLimiter: mocks.rateLimiter,
    identityRequestSecurity: { invitationRateLimitHmacSecret: 'console-secret' },
    identityPlatform: {
      listOrganizations: mocks.listOrganizations,
      provisionOrganization: mocks.provisionOrganization,
      inviteAdmin: mocks.inviteAdmin,
      resendInvitation: mocks.resendInvitation,
      cancelInvitation: mocks.cancelInvitation,
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('./platform-operator-access.server', () => ({
  requirePlatformOperator: mocks.requirePlatformOperator,
}))
vi.mock('./platform-console-rate-limit.server', () => ({
  enforcePlatformConsoleRateLimit: mocks.enforceRateLimit,
}))

import {
  cancelOrganizationAdminInvitationHandler,
  inviteOrganizationAdminHandler,
  listPlatformOrganizationsHandler,
  provisionOrganizationHandler,
  resendOrganizationAdminInvitationHandler,
} from './platform-console'

const OPERATOR = { userId: 'user-operator', email: 'owner@example.com', name: 'Bo' }
const ACTOR = { userId: 'user-operator', name: 'Bo' }
const INVITATION = { organizationId: 'org-new', invitationId: 'inv-1' }

const refusedAsNonOperator = () =>
  new ServerFunctionError(
    'AuthError',
    'This page is for platform operators.',
    'operator_not_registered',
    403,
  )

describe('platform console server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformOperator.mockResolvedValue(OPERATOR)
    mocks.enforceRateLimit.mockResolvedValue(undefined)
  })

  it('lists Organizations for an operator on any session age, drawing no budget', async () => {
    mocks.listOrganizations.mockResolvedValue([{ id: 'org-new' }])

    await expect(
      withStartContext(() => listPlatformOrganizationsHandler()),
    ).resolves.toEqual([{ id: 'org-new' }])
    expect(mocks.requirePlatformOperator).toHaveBeenCalledWith(expect.any(Headers), {
      mutation: false,
      now: NOW,
      logger: mocks.logger,
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('keeps the list, which names invitees, out of every cache', async () => {
    mocks.listOrganizations.mockResolvedValue([])

    await withStartContext(() => listPlatformOrganizationsHandler())

    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Vary', 'Cookie')
  })

  it('refuses a non-operator with the guard error and reads nothing', async () => {
    mocks.requirePlatformOperator.mockRejectedValue(refusedAsNonOperator())

    await expect(
      withStartContext(() => listPlatformOrganizationsHandler()),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'operator_not_registered',
      status: 403,
    })
    expect(mocks.listOrganizations).not.toHaveBeenCalled()
  })

  it('provisions as the operator after the recent-sign-in check and the change budget', async () => {
    mocks.provisionOrganization.mockResolvedValue({
      organizationId: 'org-new',
      slug: 'hotel-riviera',
      invitationId: 'inv-1',
      emailSent: true,
    })

    await expect(
      withStartContext(() =>
        provisionOrganizationHandler({
          data: { name: 'Hotel Riviera', adminEmail: 'admin@riviera.example' },
        }),
      ),
    ).resolves.toMatchObject({ organizationId: 'org-new', emailSent: true })

    expect(mocks.requirePlatformOperator).toHaveBeenCalledWith(
      expect.any(Headers),
      expect.objectContaining({ mutation: true }),
    )
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      rateLimiter: mocks.rateLimiter,
      operatorUserId: 'user-operator',
      keyHmacSecret: 'console-secret',
    })
    expect(mocks.provisionOrganization).toHaveBeenCalledWith(
      { name: 'Hotel Riviera', adminEmail: 'admin@riviera.example' },
      ACTOR,
    )
  })

  it('never spends a non-operator attempt from the change budget', async () => {
    mocks.requirePlatformOperator.mockRejectedValue(refusedAsNonOperator())

    await expect(
      withStartContext(() =>
        inviteOrganizationAdminHandler({
          data: { organizationId: 'org-new', email: 'admin@riviera.example' },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.inviteAdmin).not.toHaveBeenCalled()
  })

  it('changes nothing once the budget is spent', async () => {
    mocks.enforceRateLimit.mockRejectedValue(
      new ServerFunctionError('AuthError', 'Please wait', 'rate_limited', 429),
    )

    await expect(
      withStartContext(() =>
        cancelOrganizationAdminInvitationHandler({ data: INVITATION }),
      ),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
    expect(mocks.cancelInvitation).not.toHaveBeenCalled()
  })

  it('invites, resends and cancels as the operator', async () => {
    mocks.inviteAdmin.mockResolvedValue({ invitationId: 'inv-2', emailSent: true })
    mocks.resendInvitation.mockResolvedValue({
      expiresAt: '2026-10-07T12:00:00.000Z',
      emailSent: true,
    })
    mocks.cancelInvitation.mockResolvedValue(undefined)

    await expect(
      withStartContext(() =>
        inviteOrganizationAdminHandler({
          data: { organizationId: 'org-new', email: 'second@riviera.example' },
        }),
      ),
    ).resolves.toEqual({ invitationId: 'inv-2', emailSent: true })
    await expect(
      withStartContext(() =>
        resendOrganizationAdminInvitationHandler({ data: INVITATION }),
      ),
    ).resolves.toEqual({ expiresAt: '2026-10-07T12:00:00.000Z', emailSent: true })
    await expect(
      withStartContext(() =>
        cancelOrganizationAdminInvitationHandler({ data: INVITATION }),
      ),
    ).resolves.toBeUndefined()

    expect(mocks.inviteAdmin).toHaveBeenCalledWith(
      { organizationId: 'org-new', email: 'second@riviera.example' },
      ACTOR,
    )
    expect(mocks.resendInvitation).toHaveBeenCalledWith(INVITATION, ACTOR)
    expect(mocks.cancelInvitation).toHaveBeenCalledWith(INVITATION, ACTOR)
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['forbidden', 403],
    ['invitation_not_found', 404],
    ['already_exists', 409],
    ['organization_conflict', 409],
  ] as const)('maps a tagged %s refusal to %i', async (code, status) => {
    mocks.resendInvitation.mockRejectedValue(identityError(code, 'Refused'))

    await expect(
      withStartContext(() =>
        resendOrganizationAdminInvitationHandler({ data: INVITATION }),
      ),
    ).rejects.toMatchObject({ name: 'IdentityError', code, status })
  })
})
