import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  describe('how long a card is read again after', () => {
    const T0 = new Date('2026-10-17T09:00:00.000Z').getTime()
    const at = (ms: number) => vi.setSystemTime(new Date(T0 + ms))

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      at(0)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('reads a card before a goal again once it is 5 seconds old: a Portal command may have changed it', async () => {
      const queryClient = new QueryClient()
      getMonthlyPortalGoalCard.mockResolvedValue({
        state: 'drafts_only',
        drafts: [{ portalId: 'portal-spa', name: 'Spa' }],
      })

      await prefetchPortalGoalSection(queryClient, PROPERTY)
      at(4_000)
      await prefetchPortalGoalSection(queryClient, PROPERTY)
      expect(getMonthlyPortalGoalCard).toHaveBeenCalledTimes(1)

      at(6_000)
      await prefetchPortalGoalSection(queryClient, PROPERTY)
      expect(getMonthlyPortalGoalCard).toHaveBeenCalledTimes(2)
    })

    it("keeps a goal's card for 30 seconds", async () => {
      const queryClient = new QueryClient()
      getMonthlyPortalGoalCard.mockResolvedValue({
        state: 'goal',
        goal: { programId: 'program-1' },
      })

      await prefetchPortalGoalSection(queryClient, PROPERTY)
      at(29_000)
      await prefetchPortalGoalSection(queryClient, PROPERTY)
      expect(getMonthlyPortalGoalCard).toHaveBeenCalledTimes(1)

      at(31_000)
      await prefetchPortalGoalSection(queryClient, PROPERTY)
      expect(getMonthlyPortalGoalCard).toHaveBeenCalledTimes(2)
    })
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
