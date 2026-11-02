import { APIError } from 'better-auth/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import * as account from './staff-self-account'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  policy: vi.fn(),
  password: vi.fn(),
  budget: vi.fn(),
  remaining: vi.fn(),
  failed: vi.fn(),
  submit: vi.fn(),
  list: vi.fn(),
}))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn() }))
vi.mock('./staff-self-context', () => ({ resolveStaffSelfContext: mocks.resolve }))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({ api: { changePassword: mocks.password } }),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (fn: unknown) => fn,
}))
vi.mock('./beta-feedback-rate-limit.server', () => ({
  enforceBetaFeedbackRateLimit: mocks.budget,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    logger: { error: vi.fn(), warn: vi.fn() },
    rateLimiter: { remaining: mocks.remaining, check: mocks.failed },
    identityRequestSecurity: { betaFeedbackHmacSecret: 'secret' },
    identityBetaFeedback: { submit: mocks.submit, listMine: mocks.list },
  }),
}))

const actor = buildTestAuthContext({ role: 'Member' })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.remaining.mockResolvedValue(10)
  mocks.resolve.mockResolvedValue({ ctx: actor })
  mocks.submit.mockResolvedValue({ reference: 'report' })
  mocks.list.mockResolvedValue([])
})
describe('staff account actions', () => {
  it('rechecks staff access before changing the own password and rotates sessions', async () => {
    await account.changeMyStaffPasswordHandler({
      data: { currentPassword: 'Current123!', newPassword: 'NextPassword123!' },
    })
    expect(mocks.policy).toHaveBeenCalledWith({
      actor,
      action: 'staff.self',
      capability: 'staff.accounts',
    })
    expect(mocks.policy).toHaveBeenCalledWith({
      actor,
      action: 'identity.password.change',
    })
    expect(mocks.password).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        currentPassword: 'Current123!',
        newPassword: 'NextPassword123!',
        revokeOtherSessions: true,
      },
    })
  })
  it('spends the separate staff report budget and submits as the session person', async () => {
    const data = {
      kind: 'bug',
      impact: 'minor',
      description: 'The code did not draw',
    } as never
    expect(await account.submitMyStaffFeedbackHandler({ data })).toEqual({
      reference: 'report',
    })
    expect(mocks.budget).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.userId,
        organizationId: actor.organizationId,
      }),
      'staff',
    )
    expect(mocks.submit).toHaveBeenCalledWith({ actor, data })
    expect(await account.listMyStaffFeedbackHandler()).toEqual([])
    expect(mocks.list).toHaveBeenCalledWith({ actor })
  })
  it('performs no account action after removal or a capability refusal', async () => {
    const denial = new Error('Staff access ended')
    mocks.resolve.mockRejectedValue(denial)
    await expect(
      account.changeMyStaffPasswordHandler({
        data: { currentPassword: 'old', newPassword: 'new' },
      }),
    ).rejects.toBe(denial)
    await expect(account.listMyStaffFeedbackHandler()).rejects.toBe(denial)
    expect(mocks.password).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})

it('spends only failed password attempts and refuses after ten in an hour', async () => {
  let remaining = 10
  mocks.remaining.mockImplementation(async () => remaining)
  mocks.failed.mockImplementation(async () => {
    remaining -= 1
    return { allowed: true }
  })
  const data = { currentPassword: 'Current123!', newPassword: 'NextPassword123!' }
  await account.changeMyStaffPasswordHandler({ data })
  expect(mocks.failed).not.toHaveBeenCalled()
  mocks.password.mockRejectedValue(
    new APIError('BAD_REQUEST', {
      code: 'INVALID_PASSWORD',
      message: 'Invalid password',
    }),
  )
  for (let n = 0; n < 10; n += 1)
    await expect(account.changeMyStaffPasswordHandler({ data })).rejects.toMatchObject({
      code: 'password_change_failed',
    })
  expect(mocks.failed).toHaveBeenCalledTimes(10)
  await expect(account.changeMyStaffPasswordHandler({ data })).rejects.toMatchObject({
    code: 'rate_limited',
    status: 429,
  })
  expect(mocks.password).toHaveBeenCalledTimes(11)
  expect(mocks.failed).toHaveBeenCalledWith(`staff:password:failed:${actor.userId}`, {
    maxRequests: 10,
    windowSeconds: 3600,
  })
})
