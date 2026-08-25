import { describe, expect, it, vi } from 'vitest'
import { Route } from './dashboard'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'

const dashboardLoader = () => {
  const loader = Route.options.loader
  if (typeof loader !== 'function') {
    throw new Error('Dashboard route must define a loader function')
  }
  return loader
}

describe('Dashboard route loader', () => {
  it('redirects a single-property organization before rendering', async () => {
    const ensureInfiniteQueryData = vi.fn()

    await expect(
      dashboardLoader()({
        context: {
          queryClient: {
            ensureQueryData: vi.fn().mockResolvedValue({
              properties: [{ id: PROPERTY_ID, name: 'Meridian' }],
            }),
            ensureInfiniteQueryData,
          },
        },
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
          ensureQueryData: vi.fn().mockResolvedValue({
            properties: [
              { id: PROPERTY_ID, name: 'Meridian' },
              { id: '10000000-0000-4000-8000-000000000002', name: 'Harbor' },
            ],
          }),
          ensureInfiniteQueryData,
        },
      },
    } as never)

    expect(ensureInfiniteQueryData).toHaveBeenCalledOnce()
  })

  it('does not fetch fleet data for an empty organization', async () => {
    const ensureInfiniteQueryData = vi.fn()

    await dashboardLoader()({
      context: {
        queryClient: {
          ensureQueryData: vi.fn().mockResolvedValue({ properties: [] }),
          ensureInfiniteQueryData,
        },
      },
    } as never)

    expect(ensureInfiniteQueryData).not.toHaveBeenCalled()
  })
})
