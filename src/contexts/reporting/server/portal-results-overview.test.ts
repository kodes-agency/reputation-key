// Invoking a server fn outside the server runtime skips `.validator()`, so
// these tests pass complete input and assert what the handler asks of the gates
// and what it hands the use case: the roster Portal gave, the Property's own
// time zone, and nothing taken from the browser.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPortalResultsOverview: vi.fn(),
  listPortalOverview: vi.fn(),
  getPropertyTimezone: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  assertDashboardPropertyAccessible: vi.fn(),
}))

const ORG_ID = '00000000-0000-4000-8000-0000000000a1'
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'
const PORTAL_A = '22222222-2222-4222-8222-222222222221'
const PORTAL_B = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-09-30T12:00:00.000Z')

vi.mock('#/composition', () => ({
  getContainer: () => ({
    dashboardPublicApi: { getPortalResultsOverview: mocks.getPortalResultsOverview },
    portalPublicApi: { management: { listPortalOverview: mocks.listPortalOverview } },
    propertyPublicApi: { getPropertyTimezone: mocks.getPropertyTimezone },
    identityPublicApi: { people: {} },
    clock: () => NOW,
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
vi.mock('./assert-property-access', () => ({
  assertDashboardPropertyAccessible: mocks.assertDashboardPropertyAccessible,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { getPortalResultsOverviewFn } from './portal-results-overview'

const ctx = { organizationId: ORG_ID, userId: 'manager-1', role: 'PropertyManager' }

const overviewRow = (portalId: string, group: string | null) => ({
  portalId,
  propertyId: PROPERTY_ID,
  name: `Portal ${portalId.slice(-1)}`,
  group: group ? { id: group, name: 'Pool side' } : null,
})

function read(
  data: Partial<Parameters<typeof getPortalResultsOverviewFn>[0]['data']> = {},
) {
  return withStartContext(() =>
    getPortalResultsOverviewFn({
      data: { propertyId: PROPERTY_ID, timeRange: '30d', compare: true, ...data },
    }),
  )
}

describe('getPortalResultsOverviewFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ctx)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.assertDashboardPropertyAccessible.mockResolvedValue(undefined)
    mocks.getPropertyTimezone.mockResolvedValue('Europe/Sofia')
    mocks.listPortalOverview.mockResolvedValue([
      overviewRow(PORTAL_A, GROUP_ID),
      overviewRow(PORTAL_B, null),
    ])
    mocks.getPortalResultsOverview.mockResolvedValue({ marker: 'overview' })
  })

  it('reads the roster Portal owns, in the Property time zone, for the window asked', async () => {
    await read({ timeRange: '60d', compare: false })

    expect(mocks.listPortalOverview).toHaveBeenCalledWith(
      { scope: 'property', propertyId: PROPERTY_ID },
      ctx,
    )
    expect(mocks.getPropertyTimezone).toHaveBeenCalledWith(ORG_ID, PROPERTY_ID)
    expect(mocks.getPortalResultsOverview).toHaveBeenCalledWith({
      scope: { organizationId: ORG_ID, propertyId: PROPERTY_ID },
      portals: [
        { portalId: PORTAL_A, propertyId: PROPERTY_ID, groupId: GROUP_ID },
        { portalId: PORTAL_B, propertyId: PROPERTY_ID, groupId: null },
      ],
      properties: [{ propertyId: PROPERTY_ID, timezone: 'Europe/Sofia' }],
      timeRange: '60d',
      compare: false,
    })
  })

  it('asks the gates for both the Portals and the results of this Property', async () => {
    await read()

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ctx,
      action: 'portal.read',
      capability: 'portal.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ctx,
      action: 'dashboard.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.assertDashboardPropertyAccessible).toHaveBeenCalledWith(
      {},
      ctx,
      PROPERTY_ID,
    )
  })

  it('reads nothing when the Portal gate refuses', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied: org_not_allowlisted',
        'org_not_allowlisted',
        403,
      ),
    )

    await expect(read()).rejects.toMatchObject({ code: 'org_not_allowlisted' })
    expect(mocks.listPortalOverview).not.toHaveBeenCalled()
    expect(mocks.getPortalResultsOverview).not.toHaveBeenCalled()
  })

  it('reads nothing when the dashboard gate alone refuses', async () => {
    mocks.requireExecutionAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ServerFunctionError('AuthError', 'Not allowed', 'capability_disabled', 403),
      )

    await expect(read()).rejects.toMatchObject({ code: 'capability_disabled' })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledTimes(2)
    expect(mocks.listPortalOverview).not.toHaveBeenCalled()
    expect(mocks.getPortalResultsOverview).not.toHaveBeenCalled()
  })

  it('reads nothing when the caller may not see this Property (D6-001)', async () => {
    mocks.assertDashboardPropertyAccessible.mockRejectedValue(
      new ServerFunctionError('DashboardError', 'Forbidden', 'forbidden', 403),
    )

    await expect(read()).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(mocks.listPortalOverview).not.toHaveBeenCalled()
    expect(mocks.getPortalResultsOverview).not.toHaveBeenCalled()
  })

  it('asks every gate before it reads anything', async () => {
    await read()

    const gateOrders = [
      ...mocks.requireExecutionAllowed.mock.invocationCallOrder,
      ...mocks.assertDashboardPropertyAccessible.mock.invocationCallOrder,
    ]
    const readOrders = [
      ...mocks.listPortalOverview.mock.invocationCallOrder,
      ...mocks.getPropertyTimezone.mock.invocationCallOrder,
      ...mocks.getPortalResultsOverview.mock.invocationCallOrder,
    ]
    expect(Math.max(...gateOrders)).toBeLessThan(Math.min(...readOrders))
  })

  it('answers with Portal’s own refusal, tagged, when it will not list the Portals', async () => {
    mocks.listPortalOverview.mockRejectedValue({
      _tag: 'PortalError',
      code: 'forbidden',
      message: 'Not allowed to read Portals',
    })

    await expect(read()).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'forbidden',
      status: 403,
    })
    expect(mocks.getPortalResultsOverview).not.toHaveBeenCalled()
  })

  it('answers a Portal error naming something missing with a 404', async () => {
    mocks.listPortalOverview.mockRejectedValue({
      _tag: 'PortalError',
      code: 'property_not_found',
      message: 'Property not found',
    })

    await expect(read()).rejects.toMatchObject({
      code: 'property_not_found',
      status: 404,
    })
  })

  it('answers a Property with too many Portals with a 422 the page can tell from a failure', async () => {
    mocks.getPortalResultsOverview.mockRejectedValue({
      _tag: 'DashboardError',
      code: 'too_many_portals',
      message: 'Too many Portals',
    })

    await expect(read()).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'too_many_portals',
      status: 422,
    })
  })

  it('answers a not found when the Property has no time zone', async () => {
    mocks.getPropertyTimezone.mockResolvedValue(null)

    await expect(read()).rejects.toMatchObject({ code: 'not_found', status: 404 })
    expect(mocks.getPortalResultsOverview).not.toHaveBeenCalled()
  })

  it('reads no results for a Property with no Portals the caller may see', async () => {
    mocks.listPortalOverview.mockResolvedValue([])

    await read()

    expect(mocks.getPortalResultsOverview).toHaveBeenCalledWith(
      expect.objectContaining({ portals: [] }),
    )
  })
})
