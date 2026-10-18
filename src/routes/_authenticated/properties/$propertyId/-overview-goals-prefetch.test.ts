import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '#/shared/domain/roles'

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  prefetchRatingGoalOverview: vi.fn(async () => undefined),
  prefetchPortalGoalSection: vi.fn(async () => undefined),
}))

vi.mock('#/shared/domain/permissions', () => ({ can: mocks.can }))
vi.mock('./goals/-rating-goal-queries', () => ({
  prefetchRatingGoalOverview: mocks.prefetchRatingGoalOverview,
}))
vi.mock('./goals/-portal-goal-queries', () => ({
  prefetchPortalGoalSection: mocks.prefetchPortalGoalSection,
}))

import { prefetchOverviewGoals } from './-overview-goals-prefetch'

const PROPERTY = 'property-1'

describe('prefetchOverviewGoals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('primes the Google rating goal and the Monthly portal goal together', async () => {
    mocks.can.mockReturnValue(true)
    const queryClient = new QueryClient()

    await prefetchOverviewGoals(queryClient, PROPERTY, 'PropertyManager')

    expect(mocks.prefetchRatingGoalOverview).toHaveBeenCalledWith(queryClient, PROPERTY)
    expect(mocks.prefetchPortalGoalSection).toHaveBeenCalledWith(queryClient, PROPERTY)
  })

  it('reads the portal goal card only for someone who may set the goal', async () => {
    mocks.can.mockImplementation(
      (_role: Role, permission: string) => permission !== 'goal.create',
    )

    await prefetchOverviewGoals(new QueryClient(), PROPERTY, 'Member')

    expect(mocks.can).toHaveBeenCalledWith('Member', 'goal.create')
    expect(mocks.prefetchRatingGoalOverview).toHaveBeenCalledOnce()
    expect(mocks.prefetchPortalGoalSection).not.toHaveBeenCalled()
  })

  it('settles once both have, whichever way: one failing holds neither back', async () => {
    mocks.can.mockReturnValue(true)
    let releasePortal: () => void = () => undefined
    mocks.prefetchRatingGoalOverview.mockRejectedValueOnce(new Error('unavailable'))
    mocks.prefetchPortalGoalSection.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releasePortal = () => resolve(undefined)
        }),
    )
    let settled = false

    const priming = prefetchOverviewGoals(new QueryClient(), PROPERTY, 'PropertyManager')
    void priming.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    releasePortal()
    await expect(priming).resolves.toBeUndefined()
  })
})
