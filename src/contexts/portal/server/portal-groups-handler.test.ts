// Portal context — group server functions that the group dialog and page call.
// Invokes the real createServerFn handlers: scope check → use case → return.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'

const mocks = vi.hoisted(() => ({
  movePortalToGroup: vi.fn(),
  listPortalGroupHistory: vi.fn(),
  resolvePortalGroupManagementScope: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
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
        movePortalToGroup: mocks.movePortalToGroup,
        listPortalGroupHistory: mocks.listPortalGroupHistory,
        resolvePortalGroupManagementScope: mocks.resolvePortalGroupManagementScope,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
      },
    },
  })),
}))

import { listPortalGroupHistory, movePortalToGroup } from './portal-groups'

const ctx = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const
const scope = { organizationId: 'org-1', propertyId: 'property-1' }
const move = { portalGroupId: 'group-1', portalId: 'portal-1' }

describe('movePortalToGroup server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ctx)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.resolvePortalGroupManagementScope.mockResolvedValue(scope)
    mocks.resolvePortalManagementScope.mockResolvedValue({
      ...scope,
      portalId: 'portal-1',
    })
  })

  it('authorizes the group and the Portal as one property, then moves the Portal', async () => {
    await withStartContext(() => movePortalToGroup({ data: move }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ctx,
      action: 'portal.update',
      capability: 'portal.write',
      propertyId: 'property-1',
    })
    expect(mocks.movePortalToGroup).toHaveBeenCalledWith(move, ctx)
  })

  it('does not move a Portal that sits in another property than the group', async () => {
    mocks.resolvePortalManagementScope.mockResolvedValue({
      organizationId: 'org-1',
      propertyId: 'property-2',
      portalId: 'portal-1',
    })

    await expect(
      withStartContext(() => movePortalToGroup({ data: move })),
    ).rejects.toBeDefined()
    expect(mocks.movePortalToGroup).not.toHaveBeenCalled()
  })

  it('does not move anything when the property is not allowed to be written', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('property_disabled'))

    await expect(
      withStartContext(() => movePortalToGroup({ data: move })),
    ).rejects.toBeDefined()
    expect(mocks.movePortalToGroup).not.toHaveBeenCalled()
  })
})

describe('listPortalGroupHistory server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ctx)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.resolvePortalGroupManagementScope.mockResolvedValue(scope)
  })

  it('reads the ledger of a group the caller may read', async () => {
    mocks.listPortalGroupHistory.mockResolvedValue([])

    await withStartContext(() =>
      listPortalGroupHistory({ data: { portalGroupId: 'group-1' } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ctx,
      action: 'portal.read',
      capability: 'portal.read',
      propertyId: 'property-1',
    })
    expect(mocks.listPortalGroupHistory).toHaveBeenCalledWith(
      { portalGroupId: 'group-1' },
      ctx,
    )
  })

  it('answers not found, and reads nothing, for a group of another organization', async () => {
    mocks.resolvePortalGroupManagementScope.mockResolvedValue({
      organizationId: 'org-2',
      propertyId: 'property-9',
    })

    await expect(
      withStartContext(() =>
        listPortalGroupHistory({ data: { portalGroupId: 'group-1' } }),
      ),
    ).rejects.toBeDefined()
    expect(mocks.listPortalGroupHistory).not.toHaveBeenCalled()
  })
})
