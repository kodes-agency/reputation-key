// Invoking a server fn outside the server runtime skips `.validator()`, so these
// tests pass complete input and assert the fleet gate and the Property scope
// forwarded to the use case. `scope.organizationWide` is the only Property
// scoping a PropertyManager's fleet read gets: the gate carries no propertyId,
// and `true` makes getAccessiblePropertyIds answer "every Property".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataScope } from '#/shared/domain/data-scope'
import type { Permission } from '#/shared/domain/permissions'

const mocks = vi.hoisted(() => ({
  getFleetOverview: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  checkScopedCapability: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    dashboardPublicApi: { getFleetOverview: mocks.getFleetOverview },
  }),
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
vi.mock('#/shared/auth/beta-capabilities', () => ({
  checkScopedCapability: mocks.checkScopedCapability,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { getFleetOverviewFn } from './fleet-overview'

const ORG_ID = '00000000-0000-4000-8000-0000000000f1'
const accountAdmin = { organizationId: ORG_ID, userId: 'admin-1', role: 'AccountAdmin' }
const propertyManager = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
}
const member = { organizationId: ORG_ID, userId: 'member-1', role: 'Member' }

/**
 * A custom or multi-role member as resolveTenantContext builds it: the role is
 * the 'Member' placeholder and scopeByPermission is authoritative.
 */
function customRoleMember(scopes: Readonly<Partial<Record<Permission, DataScope>>>) {
  return {
    ...member,
    userId: 'custom-1',
    effectivePermissions: new Set(Object.keys(scopes)),
    scopeByPermission: new Map(Object.entries(scopes)),
  }
}

function readFleet() {
  return withStartContext(() => getFleetOverviewFn({ data: { timeRange: '30d' } }))
}

describe('getFleetOverviewFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.checkScopedCapability.mockReturnValue({ allowed: true })
    mocks.getFleetOverview.mockResolvedValue({ entries: [], nextCursor: null })
  })

  it('reads the fleet behind dashboard.read and dashboard.fleet_read', async () => {
    mocks.resolveTenantContext.mockResolvedValue(accountAdmin)
    mocks.checkScopedCapability.mockImplementation(
      (_scope: unknown, capability: string) => ({
        allowed: capability === 'portal.read',
      }),
    )

    await withStartContext(() =>
      getFleetOverviewFn({ data: { timeRange: '7d', cursor: 'cursor-1' } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: accountAdmin,
      action: 'dashboard.read',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: accountAdmin,
      action: 'dashboard.fleet_read',
    })
    expect(mocks.getFleetOverview).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      scope: { userId: 'admin-1', organizationWide: true },
      portalReadEnabled: true,
      goalReadEnabled: false,
      timeRange: '7d',
      cursor: 'cursor-1',
    })
  })

  it('does not read the fleet when dashboard.fleet_read is denied', async () => {
    mocks.resolveTenantContext.mockResolvedValue(member)
    mocks.requireExecutionAllowed.mockImplementation(
      async ({ action }: { action: Permission }) => {
        if (action === 'dashboard.fleet_read') {
          throw new ServerFunctionError(
            'AuthError',
            'Authorization denied: permission_denied',
            'permission_denied',
            403,
          )
        }
      },
    )

    await expect(readFleet()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'permission_denied',
      status: 403,
    })
    expect(mocks.getFleetOverview).not.toHaveBeenCalled()
  })

  it.each([
    { caller: 'an AccountAdmin', actor: accountAdmin, organizationWide: true },
    { caller: 'a PropertyManager', actor: propertyManager, organizationWide: false },
    {
      caller: 'a custom role whose fleet_read is narrower than its dashboard.read',
      actor: customRoleMember({
        'dashboard.read': 'organization',
        'dashboard.fleet_read': 'assigned-properties',
      }),
      organizationWide: false,
    },
    {
      caller: 'a custom role granted fleet_read organization-wide',
      actor: customRoleMember({
        'dashboard.read': 'assigned-properties',
        'dashboard.fleet_read': 'organization',
      }),
      organizationWide: true,
    },
  ])(
    'scopes the fleet from dashboard.fleet_read for $caller',
    async ({ actor, organizationWide }) => {
      mocks.resolveTenantContext.mockResolvedValue(actor)

      await readFleet()

      expect(mocks.getFleetOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          scope: { userId: actor.userId, organizationWide },
        }),
      )
    },
  )
})
