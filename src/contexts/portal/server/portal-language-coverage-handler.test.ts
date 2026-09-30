import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCoverage: vi.fn(),
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
        getPortalLanguageCoverage: mocks.getCoverage,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
      },
    },
  })),
}))
vi.mock('./property-scope', () => ({
  requirePortalResourceScope: mocks.requirePortalResourceScope,
}))
vi.mock('./portals', () => ({ portalErrorStatus: vi.fn(() => 400) }))

import { getPortalLanguageCoverage } from './portal-language-coverage'

const ACTOR = {
  userId: 'manager-1',
  organizationId: 'org-1',
  role: 'PropertyManager',
} as const

describe('getPortalLanguageCoverage handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requirePortalResourceScope.mockResolvedValue(undefined)
  })

  it('checks the Portal read scope before reading coverage', async () => {
    mocks.getCoverage.mockResolvedValue({ languages: [] })

    await withStartContext(() =>
      getPortalLanguageCoverage({ data: { portalId: 'portal-1' } }),
    )

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.read',
        capability: 'portal.read',
      }),
    )
    expect(mocks.getCoverage).toHaveBeenCalledWith({ portalId: 'portal-1' }, ACTOR)
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getCoverage.mock.invocationCallOrder[0]!,
    )
  })

  it('does not read coverage when the scope check refuses', async () => {
    mocks.requirePortalResourceScope.mockRejectedValue(new Error('refused'))

    await expect(
      withStartContext(() =>
        getPortalLanguageCoverage({ data: { portalId: 'portal-1' } }),
      ),
    ).rejects.toBeDefined()
    expect(mocks.getCoverage).not.toHaveBeenCalled()
  })
})
