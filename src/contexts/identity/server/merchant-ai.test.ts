import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  enable: vi.fn(),
  change: vi.fn(),
  revoke: vi.fn(),
  defer: vi.fn(),
  listOverview: vi.fn(),
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
          defer: mocks.defer,
          listOverview: mocks.listOverview,
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
  deferMerchantAiDecisionFn,
  getMerchantAiAuthorizationFn,
  listMerchantAiOverviewFn,
} from './merchant-ai'
import { MerchantAiAuthorizationError } from '../application/use-cases/merchant-ai-authorization'
import { merchantAiDecisionError } from '../domain/merchant-ai-decision-errors'

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

  it('gates notice-only reads without reading a property', async () => {
    await withStartContext(() => getMerchantAiAuthorizationFn({ data: {} }))
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'ai.manage',
    })
    expect(mocks.get).not.toHaveBeenCalled()
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

  it('defers for the resolved tenant actor behind the property-scoped management gate', async () => {
    mocks.defer.mockResolvedValue({
      propertyId: PROPERTY_ID,
      decisionDeferredAt: '2026-09-15T08:00:00.000Z',
    })

    // Outside the server runtime the wrapper resolves to undefined, so the
    // contract is asserted on the gate and the forwarded command.
    await withStartContext(() =>
      deferMerchantAiDecisionFn({ data: { propertyId: PROPERTY_ID } }),
    )
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'ai.manage',
      propertyId: PROPERTY_ID,
    })
    // No step-up proof and no request headers: a deferral authorizes nothing.
    expect(mocks.defer).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      actorUserId: actor.userId,
    })
  })

  it('maps an already-enabled refusal to a conflict', async () => {
    mocks.defer.mockRejectedValue(
      merchantAiDecisionError(
        'already_enabled',
        'AI is already enabled for this property',
      ),
    )

    await expect(
      withStartContext(() =>
        deferMerchantAiDecisionFn({ data: { propertyId: PROPERTY_ID } }),
      ),
    ).rejects.toMatchObject({
      name: 'MerchantAiDecisionError',
      code: 'already_enabled',
      status: 409,
    })
  })

  it('maps a Property outside the Organization to not found', async () => {
    mocks.defer.mockRejectedValue(
      merchantAiDecisionError('property_not_found', 'Property was not found'),
    )

    await expect(
      withStartContext(() =>
        deferMerchantAiDecisionFn({ data: { propertyId: PROPERTY_ID } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
  })

  it('does not defer when the management execution gate denies the request', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

    await expect(
      withStartContext(() =>
        deferMerchantAiDecisionFn({ data: { propertyId: PROPERTY_ID } }),
      ),
    ).rejects.toThrow('execution denied')
    expect(mocks.defer).not.toHaveBeenCalled()
  })

  it('lists the overview for the resolved actor behind the organization-level management gate', async () => {
    mocks.listOverview.mockResolvedValue({ properties: [] })

    await withStartContext(() => listMerchantAiOverviewFn())

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'ai.manage',
    })
    expect(mocks.listOverview).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
    })
  })

  it('maps a denied overview to forbidden', async () => {
    mocks.listOverview.mockRejectedValue(
      new MerchantAiAuthorizationError(
        'capability_denied',
        'Merchant AI overview is denied',
      ),
    )

    await expect(
      withStartContext(() => listMerchantAiOverviewFn()),
    ).rejects.toMatchObject({
      name: 'MerchantAiAuthorizationError',
      code: 'capability_denied',
      status: 403,
    })
  })

  it('does not read the overview when the management gate denies the request', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

    await expect(withStartContext(() => listMerchantAiOverviewFn())).rejects.toThrow(
      'execution denied',
    )
    expect(mocks.listOverview).not.toHaveBeenCalled()
  })
})
