import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getReview: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  resolveTenantContext: vi.fn(),
  requirePortalResourceScope: vi.fn(),
  requireExecutionAllowed: vi.fn(),
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
        getPortalReview: mocks.getReview,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
      },
    },
  })),
}))
vi.mock('./property-scope', () => ({
  requirePortalResourceScope: mocks.requirePortalResourceScope,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('./portals', () => ({ portalErrorStatus: vi.fn(() => 400) }))

import { getPortalReview } from './portal-review'

const ACTOR = {
  userId: 'manager-1',
  organizationId: 'org-1',
  role: 'PropertyManager',
} as const

describe('getPortalReview handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requirePortalResourceScope.mockResolvedValue({
      organizationId: 'org-1',
      propertyId: 'property-1',
    })
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('checks the Portal read scope before reading the review', async () => {
    mocks.getReview.mockResolvedValue({ changes: [] })

    await withStartContext(() => getPortalReview({ data: { portalId: 'portal-1' } }))

    expect(mocks.requirePortalResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.read',
        capability: 'portal.read',
      }),
    )
    expect(mocks.getReview).toHaveBeenCalledWith(
      { portalId: 'portal-1', mayPublish: true },
      ACTOR,
    )
    expect(mocks.requirePortalResourceScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getReview.mock.invocationCallOrder[0]!,
    )
  })

  it('reads nothing when the scope check refuses', async () => {
    mocks.requirePortalResourceScope.mockRejectedValue(new Error('refused'))

    await expect(
      withStartContext(() => getPortalReview({ data: { portalId: 'portal-1' } })),
    ).rejects.toBeDefined()
    expect(mocks.getReview).not.toHaveBeenCalled()
  })

  it('tells the read when the publish capability is closed, without refusing the read', async () => {
    mocks.getReview.mockResolvedValue({ changes: [] })
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('capability off'))

    await withStartContext(() => getPortalReview({ data: { portalId: 'portal-1' } }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: 'portal.update',
        capability: 'portal.write',
        propertyId: 'property-1',
      }),
    )
    expect(mocks.getReview).toHaveBeenCalledWith(
      { portalId: 'portal-1', mayPublish: false },
      ACTOR,
    )
  })
})
