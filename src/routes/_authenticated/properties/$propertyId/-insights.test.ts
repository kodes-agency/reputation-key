import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as PermissionsModule from '#/shared/domain/permissions'

const server = vi.hoisted(() => ({
  getPropertyInsights: vi.fn(async () => ({ status: 'preparing' as const })),
}))

const permissions = vi.hoisted(() => ({
  can: vi.fn(() => true),
}))

vi.mock('#/contexts/ai/server/property-insights', () => ({
  getPropertyInsightsFn: server.getPropertyInsights,
}))
vi.mock('#/shared/domain/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof PermissionsModule>()),
  can: permissions.can,
}))

import { propertyInsightsQuery, propertyInsightsSearchSchema, Route } from './insights'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'

describe('Property Insights route', () => {
  beforeEach(() => {
    permissions.can.mockReset()
    permissions.can.mockReturnValue(true)
  })

  it('uses the CORE dashboard permission and redirects when it is denied', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Property Insights route must define beforeLoad')

    permissions.can.mockReturnValue(false)
    await expect(
      Promise.resolve().then(() =>
        beforeLoad({ context: { role: 'PropertyManager' } } as never),
      ),
    ).rejects.toMatchObject({
      options: { to: '/dashboard' },
    })
    expect(permissions.can).toHaveBeenCalledWith('PropertyManager', 'dashboard.read')
  })

  it('normalizes a missing or invalid range and retains each supported preset', () => {
    expect(propertyInsightsSearchSchema.parse({})).toEqual({ range: 90 })
    expect(propertyInsightsSearchSchema.parse({ range: 'invalid' })).toEqual({
      range: 90,
    })
    expect(propertyInsightsSearchSchema.parse({ range: '30' })).toEqual({ range: 30 })
    expect(propertyInsightsSearchSchema.parse({ range: 90 })).toEqual({ range: 90 })
    expect(propertyInsightsSearchSchema.parse({ range: '180' })).toEqual({ range: 180 })
  })

  it('primes the range-specific single-property query', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Property Insights route must define a loader')
    }

    await loader({
      params: { propertyId: PROPERTY_ID },
      deps: { range: 180 },
      context: {
        queryClient: {
          ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn(),
        },
      },
    } as never)

    expect(server.getPropertyInsights).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, rangeDays: 180 },
    })
  })

  it('uses a distinct client cache entry for every selected range', () => {
    expect(propertyInsightsQuery(PROPERTY_ID, 30).queryKey).not.toEqual(
      propertyInsightsQuery(PROPERTY_ID, 90).queryKey,
    )
    expect(propertyInsightsQuery(PROPERTY_ID, 90).queryKey).not.toEqual(
      propertyInsightsQuery(PROPERTY_ID, 180).queryKey,
    )
  })
})
