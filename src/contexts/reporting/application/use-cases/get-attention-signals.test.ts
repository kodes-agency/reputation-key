import { describe, expect, it, vi } from 'vitest'
import {
  getAttentionSignals as authorizedGetAttentionSignals,
  type GetAttentionSignalsDeps,
} from './get-attention-signals'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { asAccountAdmin } from '#/shared/testing/authorized-reads'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { ReviewPeriodStats } from '../ports/review-stats.port'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORG = organizationId('org-test')
const PROPERTY = propertyId('a0000000-0000-4000-8000-000000000001')

const signals: AttentionSignalsPort = {
  getAttentionCounts: async () => ({
    overdue: 0,
    itemsToTriage: 0,
    escalated: 0,
    goalsBehindPace: 0,
    attentionWork: 0,
  }),
}

const inboxTargets = {
  getGoogleReviewTargetCountsByProperty: async () =>
    new Map([[PROPERTY, { activeCount: 0, overdueCount: 0 }]]),
}

/** What the signals say, read as an AccountAdmin; who may read is tested last. */
const getAttentionSignals = (deps: Omit<GetAttentionSignalsDeps, 'propertyAccess'>) =>
  asAccountAdmin(
    authorizedGetAttentionSignals({ ...deps, propertyAccess: async () => null }),
  )

function reviewPeriods(
  current: ReviewPeriodStats,
  prior: ReviewPeriodStats = { count: 0, avgRating: null },
) {
  let calls = 0
  return {
    getPeriodStats: async () => (calls++ === 0 ? current : prior),
  }
}

describe('getAttentionSignals', () => {
  it('does not infer a rating drop when all-time has no comparison period', async () => {
    const getSignals = getAttentionSignals({
      reviewStats: reviewPeriods({ count: 10, avgRating: 4 }),
      signals,
      inboxTargets,
      clock: () => NOW,
    })

    const result = await getSignals({
      organizationId: ORG,
      propertyId: PROPERTY,
      startDate: new Date(0),
      endDate: NOW,
      timeRange: 'all',
      propertyTimezone: 'UTC',
    })

    expect(result.ratingDrop).toBe(false)
    expect(result.needsAttention).toBe(0)
  })

  it('adds the rating-drop signal to the distinct work-anchor union', async () => {
    const overlappingSignals: AttentionSignalsPort = {
      getAttentionCounts: async () => ({
        overdue: 99,
        itemsToTriage: 4,
        escalated: 2,
        goalsBehindPace: 1,
        attentionWork: 5,
      }),
    }
    const getSignals = getAttentionSignals({
      reviewStats: reviewPeriods(
        { count: 10, avgRating: 4 },
        { count: 12, avgRating: 4.4 },
      ),
      signals: overlappingSignals,
      inboxTargets: {
        getGoogleReviewTargetCountsByProperty: async (input) => {
          expect(input).toEqual({
            organizationId: ORG,
            propertyIds: [PROPERTY],
            now: NOW,
          })
          return new Map([[PROPERTY, { activeCount: 3, overdueCount: 3 }]])
        },
      },
      clock: () => NOW,
    })
    await expect(
      getSignals({
        organizationId: ORG,
        propertyId: PROPERTY,
        startDate: new Date('2026-07-26T12:00:00.000Z'),
        endDate: NOW,
        timeRange: '30d',
        propertyTimezone: 'UTC',
      }),
    ).resolves.toEqual({
      overdue: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      ratingDrop: true,
      needsAttention: 6,
    })
  })

  it('withholds rating-drop attention below the ten-review comparison floor', async () => {
    const getSignals = getAttentionSignals({
      reviewStats: reviewPeriods(
        { count: 9, avgRating: 4 },
        { count: 10, avgRating: 4.4 },
      ),
      signals,
      inboxTargets,
      clock: () => NOW,
    })

    const result = await getSignals({
      organizationId: ORG,
      propertyId: PROPERTY,
      startDate: new Date('2026-07-26T12:00:00.000Z'),
      endDate: NOW,
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    expect(result).toMatchObject({ ratingDrop: false, needsAttention: 0 })
  })
})

describe('getAttentionSignals authorization', () => {
  const OTHER_PROPERTY = propertyId('a0000000-0000-4000-8000-000000000002')
  const manager = buildTestAuthContext({ organizationId: ORG, role: 'PropertyManager' })
  const last30Days = {
    organizationId: ORG,
    propertyId: PROPERTY,
    startDate: new Date('2026-07-26T12:00:00.000Z'),
    endDate: NOW,
    timeRange: '30d' as const,
    propertyTimezone: 'UTC',
  }

  it('refuses a manager with no grant on the Property before anything is read', async () => {
    const getAttentionCounts = vi.fn(signals.getAttentionCounts)
    const getPeriodStats = vi.fn(async () => ({ count: 10, avgRating: 4 }))
    const getSignals = authorizedGetAttentionSignals({
      reviewStats: { getPeriodStats },
      signals: { getAttentionCounts },
      inboxTargets,
      clock: () => NOW,
      propertyAccess: async () => [OTHER_PROPERTY],
    })

    await expect(getSignals(last30Days, manager)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(getAttentionCounts).not.toHaveBeenCalled()
    expect(getPeriodStats).not.toHaveBeenCalled()
  })

  it('serves a manager granted the Property', async () => {
    const getSignals = authorizedGetAttentionSignals({
      reviewStats: reviewPeriods({ count: 10, avgRating: 4 }),
      signals,
      inboxTargets,
      clock: () => NOW,
      propertyAccess: async () => [PROPERTY],
    })

    await expect(getSignals(last30Days, manager)).resolves.toMatchObject({
      ratingDrop: false,
      needsAttention: 0,
    })
  })
})
