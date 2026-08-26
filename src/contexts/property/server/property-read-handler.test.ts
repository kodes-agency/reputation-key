import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')

function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  destructiveDelete: vi.fn(),
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
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    useCases: { softDeleteProperty: mocks.destructiveDelete },
  })),
}))

import { deleteProperty } from './property-read'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

describe('LIF-01 Property deletion server boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    // Simulate a policy adapter defect or stale process that incorrectly lets
    // the legacy action through. The route must still have no destructive edge.
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('refuses a stale delete request without invoking the destructive use case', async () => {
    await expect(
      withStartContext(() => deleteProperty({ data: { propertyId: 'property-1' } })),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'forbidden',
      status: 403,
    })

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.delete',
      propertyId: 'property-1',
    })
    expect(mocks.destructiveDelete).not.toHaveBeenCalled()
  })
})
