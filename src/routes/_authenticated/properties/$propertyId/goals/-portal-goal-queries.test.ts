import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardKeys, goalKeys } from '#/shared/queries/query-keys'

const getMonthlyPortalGoalCard = vi.hoisted(() => vi.fn())

vi.mock('#/contexts/reporting/server/monthly-portal-goals', () => ({
  getMonthlyPortalGoalCard,
}))

import {
  markPortalGoalReadsStale,
  portalGoalCardQuery,
  prefetchPortalGoalSection,
} from './-portal-goal-queries'

const PROPERTY = 'property-1'

describe('the Monthly portal goal reads', () => {
  beforeEach(() => {
    getMonthlyPortalGoalCard.mockReset()
  })

  it('primes the card for one Property, and leaves a failed read to the section', async () => {
    const queryClient = new QueryClient()
    getMonthlyPortalGoalCard.mockResolvedValueOnce({ state: 'no_portal' })

    await prefetchPortalGoalSection(queryClient, PROPERTY)

    expect(getMonthlyPortalGoalCard).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY },
    })
    expect(queryClient.getQueryData(portalGoalCardQuery(PROPERTY).queryKey)).toEqual({
      state: 'no_portal',
    })

    getMonthlyPortalGoalCard.mockRejectedValueOnce(new Error('unavailable'))
    await expect(
      prefetchPortalGoalSection(new QueryClient(), 'property-2'),
    ).resolves.toBeUndefined()
  })

  it("marks a Portal goal's reads, the list and the dashboard stale, never the Google rating goal's", async () => {
    const queryClient = new QueryClient()
    const keys = {
      card: goalKeys.portalGoalRead(PROPERTY, 'card'),
      line: goalKeys.portalGoalLine(PROPERTY, 'portal-1'),
      listProgress: goalKeys.listProgress(PROPERTY),
      list: goalKeys.list({ propertyId: PROPERTY, model: 'program' }),
      fleet: dashboardKeys.fleet('30d'),
      overview: dashboardKeys.property({ propertyId: PROPERTY, range: '30d' }),
      ratingGoal: goalKeys.ratingGoalRead(PROPERTY, 'card'),
      otherProperty: goalKeys.portalGoalRead('property-2', 'card'),
    }
    for (const key of Object.values(keys)) queryClient.setQueryData(key, { read: true })

    await markPortalGoalReadsStale(queryClient, PROPERTY)

    const stale = Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [
        name,
        queryClient.getQueryState(key)?.isInvalidated,
      ]),
    )
    expect(stale).toEqual({
      card: true,
      line: true,
      listProgress: true,
      list: true,
      fleet: true,
      overview: true,
      ratingGoal: false,
      otherProperty: false,
    })
  })
})
