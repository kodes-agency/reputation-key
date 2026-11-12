// Portal context — the link reorder server function.
// A caller the policy refuses costs two lookups, however many links the
// request names: the count is the proof here. The stored outcome of every
// refusal is asserted in portal-links-handler.integration.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { policyDenial } from '#/shared/testing/policy-denial'

const mocks = vi.hoisted(() => ({
  reorderLinks: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  resolvePortalCategoryManagementScope: vi.fn(),
  resolvePortalLinkManagementScope: vi.fn(),
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
    portalPublicApi: {
      management: {
        reorderLinks: mocks.reorderLinks,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
        resolvePortalCategoryManagementScope: mocks.resolvePortalCategoryManagementScope,
        resolvePortalLinkManagementScope: mocks.resolvePortalLinkManagementScope,
      },
    },
  })),
}))

import { reorderLinks } from './portal-links'

const ctx = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'PropertyManager',
} as const
const scope = { organizationId: 'org-1', propertyId: 'property-1', portalId: 'portal-1' }
const reorder = {
  portalId: 'portal-1',
  categoryId: 'category-1',
  items: [
    { id: 'link-1', sortKey: 'a0' },
    { id: 'link-2', sortKey: 'a1' },
    { id: 'link-3', sortKey: 'a2' },
  ],
}

describe('reorderLinks server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ctx)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.resolvePortalManagementScope.mockResolvedValue(scope)
    mocks.resolvePortalCategoryManagementScope.mockResolvedValue(scope)
    mocks.resolvePortalLinkManagementScope.mockResolvedValue(scope)
    mocks.reorderLinks.mockResolvedValue(undefined)
  })

  it('reads none of the links a caller named when the policy refuses that caller', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(policyDenial('scope_denied'))

    await expect(
      withStartContext(() => reorderLinks({ data: reorder })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'scope_denied',
      status: 403,
    })

    expect(mocks.resolvePortalManagementScope).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePortalCategoryManagementScope).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePortalLinkManagementScope).not.toHaveBeenCalled()
    expect(mocks.reorderLinks).not.toHaveBeenCalled()
  })
})
