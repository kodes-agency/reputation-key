import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVersions: vi.fn(),
  getVersion: vi.fn(),
  getVersionPreview: vi.fn(),
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
        getPortalVersions: mocks.getVersions,
        getPortalVersion: mocks.getVersion,
        getPortalVersionPreview: mocks.getVersionPreview,
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
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from './portal-versions'

const ACTOR = {
  userId: 'manager-1',
  organizationId: 'org-1',
  role: 'PropertyManager',
} as const

describe('portal version reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requirePortalResourceScope.mockResolvedValue(undefined)
  })

  it('checks the Portal read scope before listing versions', async () => {
    mocks.getVersions.mockResolvedValue({ versions: [] })

    await withStartContext(() => getPortalVersions({ data: { portalId: 'portal-1' } }))

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.read',
        capability: 'portal.read',
      }),
    )
    expect(mocks.getVersions).toHaveBeenCalledWith({ portalId: 'portal-1' }, ACTOR)
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getVersions.mock.invocationCallOrder[0]!,
    )
  })

  it('checks the Portal read scope before reading one version', async () => {
    mocks.getVersion.mockResolvedValue({ version: 4 })

    await withStartContext(() =>
      getPortalVersion({ data: { portalId: 'portal-1', version: 4 } }),
    )

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledOnce()
    expect(mocks.getVersion).toHaveBeenCalledWith(
      { portalId: 'portal-1', version: 4 },
      ACTOR,
    )
  })

  it('checks the Portal read scope before drawing one version', async () => {
    mocks.getVersionPreview.mockResolvedValue({ status: 'ready' })

    await withStartContext(() =>
      getPortalVersionPreview({ data: { portalId: 'portal-1', version: 4 } }),
    )

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledOnce()
    expect(mocks.getVersionPreview).toHaveBeenCalledWith(
      { portalId: 'portal-1', version: 4 },
      ACTOR,
    )
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getVersionPreview.mock.invocationCallOrder[0]!,
    )
  })

  it('reads nothing when the scope check refuses', async () => {
    mocks.requirePortalResourceScope.mockRejectedValue(new Error('refused'))

    await expect(
      withStartContext(() => getPortalVersions({ data: { portalId: 'portal-1' } })),
    ).rejects.toBeDefined()
    await expect(
      withStartContext(() =>
        getPortalVersion({ data: { portalId: 'portal-1', version: 1 } }),
      ),
    ).rejects.toBeDefined()
    await expect(
      withStartContext(() =>
        getPortalVersionPreview({ data: { portalId: 'portal-1', version: 1 } }),
      ),
    ).rejects.toBeDefined()
    expect(mocks.getVersions).not.toHaveBeenCalled()
    expect(mocks.getVersion).not.toHaveBeenCalled()
    expect(mocks.getVersionPreview).not.toHaveBeenCalled()
  })
})
