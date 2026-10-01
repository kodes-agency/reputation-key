import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPreview: vi.fn(),
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
        getPortalPreview: mocks.getPreview,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
      },
    },
  })),
}))
vi.mock('./property-scope', () => ({
  requirePortalResourceScope: mocks.requirePortalResourceScope,
}))
vi.mock('./portals', () => ({ portalErrorStatus: vi.fn(() => 400) }))

import { getPortalPreview } from './portal-preview'

const ACTOR = {
  userId: 'manager-1',
  organizationId: 'org-1',
  role: 'PropertyManager',
} as const

describe('getPortalPreview handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requirePortalResourceScope.mockResolvedValue(undefined)
  })

  it('checks the Portal read scope before reading the preview', async () => {
    mocks.getPreview.mockResolvedValue({ status: 'unavailable' })

    await withStartContext(() =>
      getPortalPreview({ data: { portalId: 'portal-1', source: 'draft' } }),
    )

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.read',
        capability: 'portal.read',
      }),
    )
    expect(mocks.getPreview).toHaveBeenCalledWith(
      { portalId: 'portal-1', source: 'draft' },
      ACTOR,
    )
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getPreview.mock.invocationCallOrder[0]!,
    )
  })

  it('does not read the preview when the scope check refuses', async () => {
    mocks.requirePortalResourceScope.mockRejectedValue(new Error('refused'))

    await expect(
      withStartContext(() =>
        getPortalPreview({ data: { portalId: 'portal-1', source: 'draft' } }),
      ),
    ).rejects.toBeDefined()
    expect(mocks.getPreview).not.toHaveBeenCalled()
  })
})
