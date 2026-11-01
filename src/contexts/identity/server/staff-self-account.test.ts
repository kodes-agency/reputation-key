import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import * as account from './staff-self-account'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  policy: vi.fn(),
  password: vi.fn(),
  budget: vi.fn(),
  submit: vi.fn(),
  list: vi.fn(),
}))
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
    logger: { error: vi.fn() },
    rateLimiter: {},
    identityRequestSecurity: { betaFeedbackHmacSecret: 'secret' },
    identityBetaFeedback: { submit: mocks.submit, listMine: mocks.list },
  }),
}))

const actor = buildTestAuthContext({ role: 'Member' })
beforeEach(() => {
  vi.resetAllMocks()
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
  it('spends the same report budget and submits as the session person', async () => {
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
