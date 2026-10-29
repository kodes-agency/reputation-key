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

  it('uses the CORE dashboard permission and answers in the shell when it is denied', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Guest voice route must define beforeLoad')

    permissions.can.mockReturnValue(false)
    await expect(
      Promise.resolve().then(() =>
        beforeLoad({ context: { role: 'PropertyManager' } } as never),
      ),
    ).rejects.toMatchObject({
      // The denial is explained in the app shell, with the properties list (which
      // every role that reaches this route can read) as the way back.
      routeId: '/_authenticated',
      data: { cause: 'role', title: 'Guest voice', back: 'properties' },
    })
    expect(permissions.can).toHaveBeenCalledWith('PropertyManager', 'dashboard.read')
  })

  it('opens on the automatic window and retains each preset a reader can choose', () => {
    expect(propertyGuestsSearchSchema.parse({})).toEqual({ range: 'auto' })
    expect(propertyGuestsSearchSchema.parse({ range: 'invalid' })).toEqual({
      range: 'auto',
    })
    // The old numeric vocabulary is not accepted, so a stale `/insights?range=90`
    // link falls back to the default rather than half-parsing.
    expect(propertyGuestsSearchSchema.parse({ range: 90 })).toEqual({ range: 'auto' })
    expect(propertyGuestsSearchSchema.parse({ range: 'auto' })).toEqual({ range: 'auto' })
    expect(propertyGuestsSearchSchema.parse({ range: '30d' })).toEqual({ range: '30d' })
    expect(propertyGuestsSearchSchema.parse({ range: '90d' })).toEqual({ range: '90d' })
    expect(propertyGuestsSearchSchema.parse({ range: '180d' })).toEqual({ range: '180d' })
    expect(propertyGuestsSearchSchema.parse({ range: '365d' })).toEqual({ range: '365d' })
    expect(propertyGuestsSearchSchema.parse({ range: 'all' })).toEqual({ range: 'all' })
  })

  it('asks the server for the range the URL names', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Guest voice route must define a loader')
    }

    await loader({
      params: { propertyId: PROPERTY_ID },
      location: { search: { range: '180d' } },
      context: {
        queryClient: {
          ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn(),
          prefetchQuery: async () => undefined,
        },
      },
    } as never)

    expect(server.getPropertyInsights).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, range: '180d' },
    })
  })

  it('asks for the automatic window when the URL names none', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Guest voice route must define a loader')
    }

    await loader({
      params: { propertyId: PROPERTY_ID },
      location: { search: {} },
      context: {
        queryClient: {
          ensureQueryData: async (options: { queryFn: () => Promise<unknown> }) =>
            options.queryFn(),
          prefetchQuery: async () => undefined,
        },
      },
    } as never)

    expect(server.getPropertyInsights).toHaveBeenLastCalledWith({
      data: { propertyId: PROPERTY_ID, range: 'auto' },
    })
  })

  it('reads the range the URL names, not a loader dependency', () => {
    // The range is not a dependency: a new range must not be a new route match,
    // which would swap the page for its skeleton under the range control.
    expect(Route.options.loaderDeps).toBeUndefined()
  })

  it('starts the headline alongside the topics, whether or not they turn out ready', async () => {
    const loader = Route.options.loader
    if (typeof loader !== 'function') {
      throw new Error('Guest voice route must define a loader')
    }
    const prefetchQuery = vi.fn(async () => undefined)
    const run = (result: unknown) =>
      loader({
        params: { propertyId: PROPERTY_ID },
        location: { search: {} },
        context: { queryClient: { ensureQueryData: async () => result, prefetchQuery } },
      } as never)

    await run({ status: 'preparing' })
    await run({ status: 'ready' })

    // Started both times, alongside the topics.
    expect(prefetchQuery).toHaveBeenCalledTimes(2)
  })

  it('uses a distinct client cache entry for every selected range', () => {
    const keys = (['auto', '30d', '90d', '180d', '365d', 'all'] as const).map((range) =>
      JSON.stringify(propertyGuestsQuery(PROPERTY_ID, range).queryKey),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })
})
