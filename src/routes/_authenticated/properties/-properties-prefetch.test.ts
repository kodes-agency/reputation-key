import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFleetOverviewFn: vi.fn(),
}))

vi.mock('#/contexts/reporting/server/fleet-overview', () => ({
  getFleetOverviewFn: mocks.getFleetOverviewFn,
}))
vi.mock('#/routes/-queries/route-queries', () => ({
  propertySetupSummariesQuery: {
    queryKey: ['setup-summaries-test'],
    queryFn: () => Promise.resolve([{ propertyId: 'prop-1' }]),
    staleTime: 30_000,
  },
}))

import { LIFETIME, fleetQuery, prefetchPropertyList } from './-properties-prefetch'

const PAGE = { entries: [{ propertyId: 'prop-1' }], nextCursor: null }

describe('prefetchPropertyList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fills the cache with the fleet figures and the setup summaries the page reads', async () => {
    mocks.getFleetOverviewFn.mockResolvedValue(PAGE)
    const queryClient = new QueryClient()

    await prefetchPropertyList(queryClient)

    const fleet = queryClient.getQueryData(fleetQuery(LIFETIME).queryKey)
    expect(fleet).toEqual({ pages: [PAGE], pageParams: [undefined] })
    expect(queryClient.getQueryData(['setup-summaries-test'])).toEqual([
      { propertyId: 'prop-1' },
    ])
  })

  it('asks for the unbounded window, the one the page shows', async () => {
    mocks.getFleetOverviewFn.mockResolvedValue(PAGE)

    await prefetchPropertyList(new QueryClient())

    expect(mocks.getFleetOverviewFn).toHaveBeenCalledWith({ data: { timeRange: 'all' } })
  })

  it('starts both reads before either has answered', async () => {
    let releaseFleet: (page: typeof PAGE) => void = () => undefined
    mocks.getFleetOverviewFn.mockReturnValue(
      new Promise<typeof PAGE>((resolve) => {
        releaseFleet = resolve
      }),
    )
    const queryClient = new QueryClient()

    const settled = prefetchPropertyList(queryClient)
    await Promise.resolve()

    expect(mocks.getFleetOverviewFn).toHaveBeenCalledOnce()
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(['setup-summaries-test'])).toBeDefined(),
    )
    releaseFleet(PAGE)
    await settled
  })

  it('settles when the fleet read fails: a denied figure costs a column, not the page', async () => {
    mocks.getFleetOverviewFn.mockRejectedValue(new Error('denied'))
    const queryClient = new QueryClient()

    await expect(prefetchPropertyList(queryClient)).resolves.toBeUndefined()

    expect(queryClient.getQueryData(['setup-summaries-test'])).toBeDefined()
  })
})
