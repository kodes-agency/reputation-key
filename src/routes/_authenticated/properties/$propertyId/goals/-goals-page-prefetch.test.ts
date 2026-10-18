import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '#/shared/domain/roles'

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  prefetchRatingGoalSection: vi.fn(async () => undefined),
  prefetchPortalGoalSection: vi.fn(async () => undefined),
}))

vi.mock('#/shared/domain/permissions', () => ({ can: mocks.can }))
vi.mock('./-rating-goal-queries', () => ({
  prefetchRatingGoalSection: mocks.prefetchRatingGoalSection,
}))
vi.mock('./-portal-goal-queries', () => ({
  prefetchPortalGoalSection: mocks.prefetchPortalGoalSection,
}))

import { prefetchGoalsPage } from './-goals-page-prefetch'

const PROPERTY = 'property-1'

describe('prefetchGoalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('primes the Google section and the Portal goals section together', async () => {
    mocks.can.mockReturnValue(true)
    const queryClient = new QueryClient()

    await prefetchGoalsPage(queryClient, PROPERTY, 'PropertyManager')

    expect(mocks.prefetchRatingGoalSection).toHaveBeenCalledWith(queryClient, PROPERTY)
    expect(mocks.prefetchPortalGoalSection).toHaveBeenCalledWith(queryClient, PROPERTY)
  })

  it('reads the portal goal card only for someone who may set the goal', async () => {
    mocks.can.mockImplementation(
      (_role: Role, permission: string) => permission !== 'goal.create',
    )

    await prefetchGoalsPage(new QueryClient(), PROPERTY, 'Member')

    expect(mocks.can).toHaveBeenCalledWith('Member', 'goal.create')
    expect(mocks.prefetchRatingGoalSection).toHaveBeenCalledOnce()
    expect(mocks.prefetchPortalGoalSection).not.toHaveBeenCalled()
  })
})
