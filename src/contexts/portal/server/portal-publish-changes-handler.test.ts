import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  publishOne: vi.fn(),
  publishMany: vi.fn(),
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
        publishPortalChanges: mocks.publishOne,
        publishPortalsChanges: mocks.publishMany,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
      },
    },
  })),
}))
vi.mock('./property-scope', () => ({
  requirePortalResourceScope: mocks.requirePortalResourceScope,
}))
vi.mock('./portals', async (importActual) => ({
  portalErrorStatus: (await importActual<typeof import('./portals')>()).portalErrorStatus,
}))

import { portalError } from '../domain/errors'
import { publishPortalChanges, publishPortalsChanges } from './portal-publish-changes'

const ACTOR = {
  userId: 'manager-1',
  organizationId: 'org-1',
  role: 'PropertyManager',
} as const

describe('publish changes while live (server functions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requirePortalResourceScope.mockResolvedValue(undefined)
  })

  it('checks the write scope on the Portal before publishing its changes', async () => {
    mocks.publishOne.mockResolvedValue({ outcome: 'unchanged', version: 2 })

    await withStartContext(() => publishPortalChanges({ data: { portalId: 'portal-1' } }))

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.update',
        capability: 'portal.write',
      }),
    )
    expect(mocks.publishOne).toHaveBeenCalledWith({ portalId: 'portal-1' }, ACTOR)
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishOne.mock.invocationCallOrder[0]!,
    )
  })

  it('publishes nothing when the scope check refuses', async () => {
    mocks.requirePortalResourceScope.mockRejectedValue(
      portalError('forbidden', 'outside your properties'),
    )

    await expect(
      withStartContext(() => publishPortalChanges({ data: { portalId: 'portal-1' } })),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden', status: 403 })
    expect(mocks.publishOne).not.toHaveBeenCalled()
  })

  it('checks every named Portal once before the first one is published', async () => {
    mocks.publishMany.mockResolvedValue([])

    await withStartContext(() =>
      publishPortalsChanges({
        data: { portalIds: ['portal-1', 'portal-2', 'portal-1'] },
      }),
    )

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledTimes(2)
    expect(mocks.publishMany).toHaveBeenCalledWith(
      { portalIds: ['portal-1', 'portal-2', 'portal-1'] },
      ACTOR,
    )
    expect(
      Math.max(...mocks.requirePortalResourceScope.mock.invocationCallOrder),
    ).toBeLessThan(mocks.publishMany.mock.invocationCallOrder[0]!)
  })

  it('publishes none of them when one is outside the actor’s scope', async () => {
    mocks.requirePortalResourceScope
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(portalError('forbidden', 'outside your properties'))

    await expect(
      withStartContext(() =>
        publishPortalsChanges({ data: { portalIds: ['portal-1', 'portal-2'] } }),
      ),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'forbidden', status: 403 })
    expect(mocks.publishMany).not.toHaveBeenCalled()
  })

  it('leaves a Portal that no longer exists to the use case, which reports it on its own', async () => {
    mocks.requirePortalResourceScope
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(portalError('portal_not_found', 'portal not found'))
    mocks.publishMany.mockResolvedValue([])

    await withStartContext(() =>
      publishPortalsChanges({ data: { portalIds: ['portal-1', 'gone'] } }),
    )

    expect(mocks.publishMany).toHaveBeenCalledWith(
      { portalIds: ['portal-1', 'gone'] },
      ACTOR,
    )
  })

  it('still refuses a single Portal that does not exist', async () => {
    mocks.requirePortalResourceScope.mockRejectedValue(
      portalError('portal_not_found', 'portal not found'),
    )

    await expect(
      withStartContext(() => publishPortalChanges({ data: { portalId: 'gone' } })),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_not_found',
      status: 404,
    })
    expect(mocks.publishOne).not.toHaveBeenCalled()
  })
})
