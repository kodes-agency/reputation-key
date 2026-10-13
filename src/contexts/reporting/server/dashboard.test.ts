// Invoking a server fn outside the server runtime skips `.validator()` and
// hides the handler's return value, so these tests pass complete input and
// assert calls and refusals. They pin what the three Property dashboard
// handlers hand the use case: the Property's own time zone and the reader the
// use case authorizes. The Property decision itself is the use case's
// (application/dashboard-property-access), not the handler's.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDashboardData: vi.fn(),
  getPropertyOverview: vi.fn(),
  getPortalAnalytics: vi.fn(),
  getPropertyTimezone: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

const ORG_ID = '00000000-0000-4000-8000-0000000000a1'
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'
const PORTAL_ID = '22222222-2222-4222-8222-222222222221'
const NOW = new Date('2026-09-30T12:00:00.000Z')

vi.mock('#/composition', () => ({
  getContainer: () => ({
    dashboardPublicApi: {
      getDashboardData: mocks.getDashboardData,
      getPropertyOverview: mocks.getPropertyOverview,
      getPortalAnalytics: mocks.getPortalAnalytics,
    },
    propertyPublicApi: { getPropertyTimezone: mocks.getPropertyTimezone },
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
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { dashboardError } from '../domain/dashboard-errors'
import { getDashboardDataFn, getPropertyOverviewFn } from './dashboard'
import { getPortalAnalyticsFn } from './portal-analytics'

const ctx = { organizationId: ORG_ID, userId: 'manager-1', role: 'PropertyManager' }
const propertyRead = { propertyId: PROPERTY_ID, timeRange: '30d' as const }

/** The policy question every Property dashboard handler asks. */
const DASHBOARD_READ_ON_PROPERTY = {
  actor: ctx,
  action: 'dashboard.read',
  propertyId: PROPERTY_ID,
} as const

const reads = [
  {
    name: 'getDashboardDataFn',
    useCase: mocks.getDashboardData,
    call: () => withStartContext(() => getDashboardDataFn({ data: propertyRead })),
    asks: [DASHBOARD_READ_ON_PROPERTY],
  },
  {
    // The overview carries the attention band, which a dashboard.read holder
    // without dashboard.fleet_read (a Member) may not read.
    name: 'getPropertyOverviewFn',
    useCase: mocks.getPropertyOverview,
    call: () => withStartContext(() => getPropertyOverviewFn({ data: propertyRead })),
    asks: [DASHBOARD_READ_ON_PROPERTY, { actor: ctx, action: 'dashboard.fleet_read' }],
  },
  {
    name: 'getPortalAnalyticsFn',
    useCase: mocks.getPortalAnalytics,
    call: () =>
      withStartContext(() =>
        getPortalAnalyticsFn({ data: { ...propertyRead, portalId: PORTAL_ID } }),
      ),
    asks: [DASHBOARD_READ_ON_PROPERTY],
  },
] as const

describe.each(reads)('$name', ({ useCase, call, asks }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ctx)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.getPropertyTimezone.mockResolvedValue('Europe/Sofia')
    useCase.mockResolvedValue({ marker: 'read' })
  })

  it('asks the execution policy about the reader, the permission and the Property', async () => {
    await call()

    expect(mocks.requireExecutionAllowed.mock.calls.map(([request]) => request)).toEqual(
      asks,
    )
  })

  it('hands the use case the reader it authorizes, for the session Organization', async () => {
    await call()

    expect(useCase).toHaveBeenCalledTimes(1)
    expect(useCase).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        propertyTimezone: 'Europe/Sofia',
      }),
      ctx,
    )
  })

  it('answers a 403 when the use case refuses the reader for the Property (D6-001)', async () => {
    useCase.mockRejectedValue(
      dashboardError('forbidden', 'Property not assigned to caller'),
    )

    await expect(call()).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
      status: 403,
    })
  })

  it('reads nothing when the execution policy refuses first', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError('AuthError', 'Not allowed', 'capability_disabled', 403),
    )

    await expect(call()).rejects.toMatchObject({ code: 'capability_disabled' })
    expect(mocks.getPropertyTimezone).not.toHaveBeenCalled()
    expect(useCase).not.toHaveBeenCalled()
  })
})
