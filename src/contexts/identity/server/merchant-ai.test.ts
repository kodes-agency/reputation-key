import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  enable: vi.fn(),
  change: vi.fn(),
  revoke: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: {
        merchantAiAuthorization: {
          get: mocks.get,
          enable: mocks.enable,
          change: mocks.change,
          revoke: mocks.revoke,
        },
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ 'x-request-id': 'request-1' })),
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
  changeMerchantAiCapabilitiesFn,
  getMerchantAiAuthorizationFn,
} from './merchant-ai'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const actor = {
  organizationId: '00000000-0000-4000-8000-000000000002',
  userId: 'user-1',
  role: 'AccountAdmin',
}

describe('Merchant AI server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('gates and scopes authorization reads to the resolved tenant actor', async () => {
    const authorization = { state: 'disabled', stateVersion: 3 }
    mocks.get.mockResolvedValue(authorization)

    await withStartContext(() =>
      getMerchantAiAuthorizationFn({ data: { propertyId: PROPERTY_ID } }),
    )
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'ai.manage',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.get).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      actorUserId: actor.userId,
    })
  })

  it('forwards only validated capability changes with step-up proof', async () => {
    const changed = { state: 'enabled', stateVersion: 4 }
    mocks.change.mockResolvedValue(changed)

    await withStartContext(() =>
      changeMerchantAiCapabilitiesFn({
        data: {
          propertyId: PROPERTY_ID,
          idempotencyKey: 'request-key-1',
          expectedStateVersion: 3,
          password: 'step-up-secret',
          capabilities: ['review_analysis', 'property_trends'],
        },
      }),
    )
    expect(mocks.change).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        actorUserId: actor.userId,
        idempotencyKey: 'request-key-1',
        expectedStateVersion: 3,
        stepUpProof: 'step-up-secret',
        reasonCode: 'capabilities_changed',
        capabilities: ['review_analysis', 'property_trends'],
        requestHeaders: expect.any(Headers),
      }),
    )
  })

  it('stops mutation when the management execution gate denies the request', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

    await expect(
      withStartContext(() =>
        changeMerchantAiCapabilitiesFn({
          data: {
            propertyId: PROPERTY_ID,
            idempotencyKey: 'request-key-1',
            expectedStateVersion: 3,
            password: 'step-up-secret',
            capabilities: ['review_analysis'],
          },
        }),
      ),
    ).rejects.toThrow('execution denied')
    expect(mocks.change).not.toHaveBeenCalled()
  })
})
