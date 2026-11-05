import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  getContainer: vi.fn(),
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
  getContainer: mocks.getContainer,
}))

import { deleteProperty } from './properties'

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

  it('refuses a stale delete request before accessing Property services', async () => {
    await expect(
      withStartContext(() => deleteProperty({ data: { propertyId: 'property-1' } })),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'forbidden',
      status: 403,
      message: 'Permanent property removal is not available in this beta.',
    })

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'property.delete',
      propertyId: 'property-1',
    })
    expect(mocks.getContainer).not.toHaveBeenCalled()
  })
})
