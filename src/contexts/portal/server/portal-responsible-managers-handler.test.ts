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
  resolvePortalManagementScope: vi.fn(),
  resolveTenantContext: vi.fn(),
  requirePortalResourceScope: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    portalPublicApi: {
      management: {
        listPortalResponsibleManagers: mocks.list,
        updatePortalResponsibleManagers: mocks.update,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
      },
    },
  })),
}))
vi.mock('./property-scope', () => ({
  requirePortalResourceScope: mocks.requirePortalResourceScope,
}))
vi.mock('./portals', () => ({ portalErrorStatus: vi.fn(() => 400) }))

import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './portal-responsible-managers'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

describe('Portal responsible-manager handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requirePortalResourceScope.mockResolvedValue(undefined)
  })

  it('authorizes Portal read before listing responsibility', async () => {
    mocks.list.mockResolvedValue({ revision: 3, managerUserIds: ['manager-1'] })

    await withStartContext(() =>
      listPortalResponsibleManagers({ data: { portalId: 'portal-1' } }),
    )

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.read',
        capability: 'portal.read',
      }),
    )
    expect(mocks.list).toHaveBeenCalledWith({ portalId: 'portal-1' }, ACTOR)
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.list.mock.invocationCallOrder[0]!,
    )
  })

  it('authorizes Portal write and preserves optimistic concurrency input', async () => {
    const data = {
      portalId: 'portal-1',
      managerUserIds: ['manager-1', 'manager-2'],
      expectedRevision: 4,
    }
    mocks.update.mockResolvedValue({ revision: 5 })

    await withStartContext(() => updatePortalResponsibleManagers({ data }))

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.update',
        capability: 'portal.write',
      }),
    )
    expect(mocks.update).toHaveBeenCalledWith(data, ACTOR)
  })
})
