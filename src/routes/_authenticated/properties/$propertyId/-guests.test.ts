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

import { propertyGuestsQuery, propertyGuestsSearchSchema, Route } from './guests'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'

describe('Guest voice route', () => {
  beforeEach(() => {
    permissions.can.mockReset()
    permissions.can.mockReturnValue(true)
  })

  it('uses the CORE dashboard permission and redirects when it is denied', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Guest voice route must define beforeLoad')

    permissions.can.mockReturnValue(false)
    await expect(
      Promise.resolve().then(() =>
        beforeLoad({ context: { role: 'PropertyManager' } } as never),
      ),
    ).rejects.toMatchObject({
      // `/dashboard` is gone (redesign row 3); a denial lands on the properties
      // list, which every role that reaches this route can read.
      options: { to: '/properties' },
    })
    expect(permissions.can).toHaveBeenCalledWith('PropertyManager', 'dashboard.read')
  })

  it('normalizes a missing or invalid range and retains each shared preset', () => {
    expect(propertyGuestsSearchSchema.parse({})).toEqual({ range: '90d' })
    expect(propertyGuestsSearchSchema.parse({ range: 'invalid' })).toEqual({
      range: '90d',
    })
    // The old numeric vocabulary is not accepted, so a stale `/insights?range=90`
    // link falls back to the default rather than half-parsing.
    expect(propertyGuestsSearchSchema.parse({ range: 90 })).toEqual({ range: '90d' })
    expect(propertyGuestsSearchSchema.parse({ range: '30d' })).toEqual({ range: '30d' })
    expect(propertyGuestsSearchSchema.parse({ range: '180d' })).toEqual({ range: '180d' })
    expect(propertyGuestsSearchSchema.parse({ range: 'all' })).toEqual({ range: 'all' })
  })

  it('converts the shared range into the AI context vocabulary', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Guest voice route must define a loader')
    }

    await loader({
      params: { propertyId: PROPERTY_ID },
      deps: { range: '180d' },
      context: {
        queryClient: {
          ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn(),
        },
      },
    } as never)

    expect(server.getPropertyInsights).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, range: 180 },
    })
  })

  it('uses a distinct client cache entry for every selected range', () => {
    const keys = (['30d', '90d', '180d', 'all'] as const).map((range) =>
      JSON.stringify(propertyGuestsQuery(PROPERTY_ID, range).queryKey),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})
