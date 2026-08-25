import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')

function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
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
    useCases: {
      listPropertyResponsibleManagers: mocks.list,
      updatePropertyResponsibleManagers: mocks.update,
    },
  })),
}))
vi.mock('./property-shared', () => ({
  propertyErrorStatus: vi.fn(() => 400),
}))

import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './property-responsible-managers'

const PROPERTY_ID = 'b7400000-0000-4000-8000-000000000010'
const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

describe('Property responsible-manager handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('checks Property execution policy before listing responsibility', async () => {
    mocks.list.mockResolvedValue({ revision: 2, managerUserIds: ['manager-1'] })

    await withStartContext(() =>
      listPropertyResponsibleManagers({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.list).toHaveBeenCalledWith({ propertyId: PROPERTY_ID }, ACTOR)
    expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.list.mock.invocationCallOrder[0]!,
    )
  })

  it('checks Property update policy and preserves optimistic concurrency input', async () => {
    const data = {
      propertyId: PROPERTY_ID,
      managerUserIds: ['manager-1', 'manager-2'],
      expectedRevision: 2,
    }
    mocks.update.mockResolvedValue({ revision: 3 })

    await withStartContext(() => updatePropertyResponsibleManagers({ data }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.update',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.update).toHaveBeenCalledWith(data, ACTOR)
  })
})
