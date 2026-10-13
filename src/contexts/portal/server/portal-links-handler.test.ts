// Portal context — the link reorder server function.
// Invokes the real createServerFn handler: the Portal and the category decide
// the Property, the policy is asked, and only then are the links the caller
// named read. A caller the policy refuses costs two lookups, however many
// links the request names.

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

const firstCallOrder = (mock: ReturnType<typeof vi.fn>): number =>
  Math.min(...mock.mock.invocationCallOrder)

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

  it('asks the policy on the Portal and the category, then reads the links and reorders', async () => {
    await withStartContext(() => reorderLinks({ data: reorder }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ctx,
      action: 'portal.update',
      capability: 'portal.write',
      propertyId: 'property-1',
    })
    expect(mocks.resolvePortalLinkManagementScope.mock.calls.map(([id]) => id)).toEqual([
      'link-1',
      'link-2',
      'link-3',
    ])
    expect(firstCallOrder(mocks.requireExecutionAllowed)).toBeLessThan(
      firstCallOrder(mocks.resolvePortalLinkManagementScope),
    )
    expect(mocks.reorderLinks).toHaveBeenCalledWith(reorder, ctx)
  })

  it('answers not found, and reorders nothing, for a link that sits in another Portal', async () => {
    mocks.resolvePortalLinkManagementScope.mockImplementation(async (id: string) =>
      id === 'link-2' ? { ...scope, portalId: 'portal-2' } : scope,
    )

    await expect(
      withStartContext(() => reorderLinks({ data: reorder })),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'link_not_found',
      status: 404,
    })
    expect(mocks.reorderLinks).not.toHaveBeenCalled()
  })

  it('answers not found, and reorders nothing, for a link id that names no row', async () => {
    mocks.resolvePortalLinkManagementScope.mockImplementation(async (id: string) =>
      id === 'link-3' ? null : scope,
    )

    await expect(
      withStartContext(() => reorderLinks({ data: reorder })),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'link_not_found',
      status: 404,
    })
    expect(mocks.reorderLinks).not.toHaveBeenCalled()
  })

  it('answers not found before the policy or any link for a category of another Portal', async () => {
    mocks.resolvePortalCategoryManagementScope.mockResolvedValue({
      ...scope,
      portalId: 'portal-2',
    })

    await expect(
      withStartContext(() => reorderLinks({ data: reorder })),
    ).rejects.toMatchObject({
      name: 'PortalError',
      code: 'link_not_found',
      status: 404,
    })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.resolvePortalLinkManagementScope).not.toHaveBeenCalled()
  })
})
