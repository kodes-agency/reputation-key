import { describe, expect, it, vi } from 'vitest'
import { Route } from './dashboard'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const COMPLETE_CHECKLIST = { state: 'complete' }

function ensureRouteData(properties: readonly { id: string; name: string }[]) {
  return vi.fn(async (options: { queryKey?: readonly unknown[] }) =>
    options.queryKey?.includes('setup-checklist') ? COMPLETE_CHECKLIST : { properties },
  )
}

const dashboardLoader = () => {
  const loader = Route.options.loader
  if (typeof loader !== 'function') {
    throw new Error('Dashboard route must define a loader function')
  }
  return loader
}

describe('Dashboard route access', () => {
  it('sends a role without fleet access to the unavailable page', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('Dashboard route must define beforeLoad')

    await expect(
      Promise.resolve().then(() => beforeLoad({ context: { role: 'Staff' } } as never)),
    ).rejects.toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Dashboard' },
      },
    })
  })
})

describe('Dashboard route loader', () => {
  it('redirects a single-property organization before rendering', async () => {
    const ensureInfiniteQueryData = vi.fn()

    await expect(
      dashboardLoader()({
        context: {
          queryClient: {
            ensureQueryData: ensureRouteData([{ id: PROPERTY_ID, name: 'Meridian' }]),
            ensureInfiniteQueryData,
          },
        },
        deps: { timeRange: '30d' },
      } as never),
    ).rejects.toMatchObject({
      options: {
        to: '/properties/$propertyId',
        params: { propertyId: PROPERTY_ID },
      },
    })
    expect(ensureInfiniteQueryData).not.toHaveBeenCalled()
  })

  it('primes fleet data only for multi-property organizations', async () => {
    const ensureInfiniteQueryData = vi.fn().mockResolvedValue(undefined)

    await dashboardLoader()({
      context: {
        queryClient: {
          ensureQueryData: ensureRouteData([
            { id: PROPERTY_ID, name: 'Meridian' },
            { id: '10000000-0000-4000-8000-000000000002', name: 'Harbor' },
          ]),
          ensureInfiniteQueryData,
        },
      },
      deps: { timeRange: '30d' },
    } as never)

    expect(ensureInfiniteQueryData).toHaveBeenCalledOnce()
  })

  it('does not fetch fleet data for an empty organization', async () => {
    const ensureInfiniteQueryData = vi.fn()

    await dashboardLoader()({
      context: {
        queryClient: {
          ensureQueryData: ensureRouteData([]),
          ensureInfiniteQueryData,
        },
      },
      deps: { timeRange: '30d' },
    } as never)

    expect(ensureInfiniteQueryData).not.toHaveBeenCalled()
  })

  it('keeps an incomplete single-property setup resumable on the Dashboard', async () => {
    const ensureInfiniteQueryData = vi.fn()
    const ensureQueryData = vi.fn(async (options: { queryKey?: readonly unknown[] }) =>
      options.queryKey?.includes('setup-checklist')
        ? { state: 'in_progress' }
        : { properties: [{ id: PROPERTY_ID, name: 'Meridian' }] },
    )

    await expect(
      dashboardLoader()({
        context: { queryClient: { ensureQueryData, ensureInfiniteQueryData } },
        deps: { timeRange: '30d' },
      } as never),
    ).resolves.toBeUndefined()
    expect(ensureInfiniteQueryData).not.toHaveBeenCalled()
  })
})
