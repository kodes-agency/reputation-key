import { describe, expect, it } from 'vitest'
import { getAttentionSignals } from './get-attention-signals'
import { organizationId, propertyId } from '#/shared/domain/ids'
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
