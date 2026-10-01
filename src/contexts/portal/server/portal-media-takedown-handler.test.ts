import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  takeDown: vi.fn(),
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
    portalPublicApi: { management: { takeDownPortalMedia: mocks.takeDown } },
  })),
}))
vi.mock('./portals', () => ({ portalErrorStatus: vi.fn(() => 404) }))

import { takeDownPortalMedia } from './portal-media-takedown'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const
const ASSET = '30000000-0000-4000-8000-000000000001'

describe('takeDownPortalMedia handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('asks for portal.write, not portal.upload, so a takedown works with uploads off', async () => {
    mocks.takeDown.mockResolvedValue({ assetId: ASSET, objectRemoved: true })

    await withStartContext(() => takeDownPortalMedia({ data: { assetId: ASSET } }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledExactlyOnceWith({
      actor: ACTOR,
      action: 'portal.admin',
      capability: 'portal.write',
    })
    expect(mocks.takeDown).toHaveBeenCalledWith({ assetId: ASSET }, ACTOR)
  })

  it('does not run the use case when the capability refuses', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('refused'))
    await expect(
      withStartContext(() => takeDownPortalMedia({ data: { assetId: ASSET } })),
    ).rejects.toBeDefined()
    expect(mocks.takeDown).not.toHaveBeenCalled()
  })
})
