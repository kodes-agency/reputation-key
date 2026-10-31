import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  markSeen: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { merchantAiNoticeUpdates: { get: mocks.get, markSeen: mocks.markSeen } },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  getMerchantAiNoticeUpdateFn,
  markMerchantAiNoticeUpdateSeenFn,
} from './merchant-ai-notice-updates'

const actor = {
  organizationId: 'session-org',
  userId: 'session-user',
  role: 'AccountAdmin',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveTenantContext.mockResolvedValue(actor)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
})
describe('AI update announcement server boundary', () => {
  it('checks ai.manage and scopes the unseen read to the session organization and user', async () => {
    // Untransformed Start's client middleware expects an object envelope;
    // nullable application results are tested in the use case.
    mocks.get.mockResolvedValue({ noticeVersion: 'fixture-v1' })
    await withStartContext(() => getMerchantAiNoticeUpdateFn())
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledExactlyOnceWith({
      actor,
      action: 'ai.manage',
    })
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'session-org',
      actorUserId: 'session-user',
    })
  })
  it('records a receipt with session scope and only the validated notice pair', async () => {
    const data = { noticeVersion: 'notice-v1', noticeDigest: 'a'.repeat(64) }
    await withStartContext(() => markMerchantAiNoticeUpdateSeenFn({ data }))
    expect(mocks.markSeen).toHaveBeenCalledExactlyOnceWith({
      ...data,
      organizationId: 'session-org',
      actorUserId: 'session-user',
    })
  })
  it('refuses a PropertyManager even if a permission gate allowed them', async () => {
    mocks.resolveTenantContext.mockResolvedValue({ ...actor, role: 'PropertyManager' })
    await expect(
      withStartContext(() => getMerchantAiNoticeUpdateFn()),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      withStartContext(() =>
        markMerchantAiNoticeUpdateSeenFn({
          data: { noticeVersion: 'v1', noticeDigest: 'a'.repeat(64) },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.markSeen).not.toHaveBeenCalled()
  })
})
