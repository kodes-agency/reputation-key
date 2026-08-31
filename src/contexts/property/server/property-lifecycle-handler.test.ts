import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')

const withStartContext = <T>(fn: () => Promise<T>): Promise<T> => {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  archiveProperty: vi.fn(),
  restoreProperty: vi.fn(),
  disconnectPropertyGoogleBinding: vi.fn(),
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
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    propertyPublicApi: {
      management: {
        archiveProperty: mocks.archiveProperty,
        restoreProperty: mocks.restoreProperty,
        disconnectPropertyGoogleBinding: mocks.disconnectPropertyGoogleBinding,
      },
    },
  })),
}))

import {
  archivePropertyHandler,
  disconnectPropertyGoogleBindingHandler,
  restorePropertyHandler,
} from './property-lifecycle'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

describe('Property lifecycle server boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('routes Archive through its dedicated permission and use case', async () => {
    const archived = { id: 'property-1', lifecycleState: 'archived' }
    mocks.archiveProperty.mockResolvedValue(archived)

    await expect(
      withStartContext(() =>
        archivePropertyHandler({
          data: { propertyId: 'property-1', reason: 'Property no longer trading' },
        }),
      ),
    ).resolves.toEqual({ property: archived })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.archive',
      propertyId: 'property-1',
    })
    expect(mocks.archiveProperty).toHaveBeenCalledWith(
      { propertyId: 'property-1', reason: 'Property no longer trading' },
      ACTOR,
    )
  })

  it('routes Restore through its dedicated permission and use case', async () => {
    const result = { property: { id: 'property-1', lifecycleState: 'active' } }
    mocks.restoreProperty.mockResolvedValue(result)

    await expect(
      withStartContext(() =>
        restorePropertyHandler({ data: { propertyId: 'property-1' } }),
      ),
    ).resolves.toEqual(result)
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.restore',
      propertyId: 'property-1',
    })
    expect(mocks.restoreProperty).toHaveBeenCalledWith(
      { propertyId: 'property-1' },
      ACTOR,
    )
  })

  it('routes Google disconnect through its dedicated permission and use case', async () => {
    const result = { state: 'disconnected', sourceEpoch: 3 }
    mocks.disconnectPropertyGoogleBinding.mockResolvedValue(result)

    await expect(
      withStartContext(() =>
        disconnectPropertyGoogleBindingHandler({
          data: { propertyId: 'property-1' },
        }),
      ),
    ).resolves.toEqual({ binding: result })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.disconnect',
      propertyId: 'property-1',
    })
    expect(mocks.disconnectPropertyGoogleBinding).toHaveBeenCalledWith(
      { propertyId: 'property-1' },
      ACTOR,
    )
  })
})
