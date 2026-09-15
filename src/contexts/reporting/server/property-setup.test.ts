// Invoking a server fn outside the server runtime resolves to undefined and
// skips `.validator()`, so these tests assert the gate, the scope forwarded to
// the use case, and the errors that propagate.

import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPropertySetup: vi.fn(),
  listPropertySetupSummaries: vi.fn(),
  getAccessiblePropertyIds: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    dashboardPublicApi: {
      getPropertySetup: mocks.getPropertySetup,
      listPropertySetupSummaries: mocks.listPropertySetupSummaries,
    },
    identityPublicApi: {
      people: { getAccessiblePropertyIds: mocks.getAccessiblePropertyIds },
    },
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
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { dashboardError } from '../domain/dashboard-errors'
import { getPropertySetupFn, listPropertySetupSummariesFn } from './property-setup'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const ORG_ID = '00000000-0000-4000-8000-0000000000e1'
const PROPERTY_ID = '00000000-0000-4000-8000-0000000000e2'
const accountAdmin = { organizationId: ORG_ID, userId: 'admin-1', role: 'AccountAdmin' }
const propertyManager = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
}

describe('property setup server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.getPropertySetup.mockResolvedValue({
      propertyId: PROPERTY_ID,
      steps: [],
      attentionCount: 0,
    })
    mocks.listPropertySetupSummaries.mockResolvedValue([])
  })

  it('reads one Property organization-wide for an AccountAdmin behind the property gate', async () => {
    mocks.resolveTenantContext.mockResolvedValue(accountAdmin)
    mocks.getAccessiblePropertyIds.mockResolvedValue(null)

    await withStartContext(() =>
      getPropertySetupFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: accountAdmin,
      action: 'property.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.getAccessiblePropertyIds).toHaveBeenCalledWith(ORG_ID, 'admin-1', true)
    expect(mocks.getPropertySetup).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      role: 'AccountAdmin',
      propertyId: PROPERTY_ID,
      accessiblePropertyIds: null,
    })
  })

  it('passes a PropertyManager grant set and role through to the use case', async () => {
    mocks.resolveTenantContext.mockResolvedValue(propertyManager)
    mocks.getAccessiblePropertyIds.mockResolvedValue([PROPERTY_ID])

    await withStartContext(() =>
      getPropertySetupFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.getAccessiblePropertyIds).toHaveBeenCalledWith(
      ORG_ID,
      'manager-1',
      false,
    )
    expect(mocks.getPropertySetup).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'PropertyManager',
        accessiblePropertyIds: [PROPERTY_ID],
      }),
    )
  })

  it('maps a tagged not-found refusal to its HTTP status', async () => {
    mocks.resolveTenantContext.mockResolvedValue(accountAdmin)
    mocks.getAccessiblePropertyIds.mockResolvedValue(null)
    mocks.getPropertySetup.mockRejectedValue(
      dashboardError('not_found', 'Property was not found'),
    )

    await expect(
      withStartContext(() => getPropertySetupFn({ data: { propertyId: PROPERTY_ID } })),
    ).rejects.toMatchObject({ name: 'DashboardError', code: 'not_found', status: 404 })
  })

  it('does not read setup when the execution gate denies the Property', async () => {
    mocks.resolveTenantContext.mockResolvedValue(propertyManager)
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied: scope_denied',
        'scope_denied',
        403,
      ),
    )

    await expect(
      withStartContext(() => getPropertySetupFn({ data: { propertyId: PROPERTY_ID } })),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })
    expect(mocks.getAccessiblePropertyIds).not.toHaveBeenCalled()
    expect(mocks.getPropertySetup).not.toHaveBeenCalled()
  })

  it('summarises the accessible Properties behind the organization-level property gate', async () => {
    mocks.resolveTenantContext.mockResolvedValue(propertyManager)
    mocks.getAccessiblePropertyIds.mockResolvedValue([PROPERTY_ID])

    await withStartContext(() => listPropertySetupSummariesFn())

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: propertyManager,
      action: 'property.read',
    })
    expect(mocks.listPropertySetupSummaries).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      role: 'PropertyManager',
      accessiblePropertyIds: [PROPERTY_ID],
    })
  })

  it('maps a forbidden summary read for a beta-dark role', async () => {
    mocks.resolveTenantContext.mockResolvedValue({ ...accountAdmin, role: 'Member' })
    mocks.getAccessiblePropertyIds.mockResolvedValue([])
    mocks.listPropertySetupSummaries.mockRejectedValue(
      dashboardError('forbidden', 'Property setup is unavailable for this role'),
    )

    await expect(
      withStartContext(() => listPropertySetupSummariesFn()),
    ).rejects.toMatchObject({ name: 'DashboardError', code: 'forbidden', status: 403 })
  })
})
