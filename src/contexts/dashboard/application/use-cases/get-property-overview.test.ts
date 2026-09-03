import { describe, expect, it } from 'vitest'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import { getDashboardData } from './get-dashboard-data'
import { getPropertyOverview } from './get-property-overview'
import type { MetricKPIValue } from '../../domain/types'

const NOW = new Date('2026-08-25T12:00:00.000Z')

const metricKpi = (value: number, priorValue: number, trend: number): MetricKPIValue => ({
  value,
  priorValue,
  trend,
  evidence: {
    current: {
      state: 'ready',
      definitionVersionId: 'overview-current',
      sampleCount: value,
      minimumSample: 1,
    },
    prior: {
      state: 'ready',
      definitionVersionId: 'overview-prior',
      sampleCount: priorValue,
      minimumSample: 1,
    },
  },
})

describe('getPropertyOverview', () => {
  it('reuses the dashboard KPI snapshot when deriving attention signals', async () => {
    const repo = createInMemoryDashboardRepository()
    repo.kpisOverride = {
      reviews: { value: 12, priorValue: 10, trend: 20 },
      avgRating: {
        value: 4,
        priorValue: 4.4,
        comparison: -0.4,
        sampleCount: 12,
        priorSampleCount: 10,
        evidence: {
          definitionVersionId: null,
          state: 'ready',
          verifiedThrough: NOW,
          latestActivity: NOW,
          computedAt: NOW,
          completeness: 1,
          availabilityReason: null,
          correctionHead: null,
          sampleCount: 12,
        },
      },
      scans: metricKpi(100, 80, 25),
      feedback: metricKpi(20, 15, 33),
    }
    const attention: AttentionSignalsPort = {
      getAttentionCounts: async () => ({
        overdue: 99,
        itemsToTriage: 4,
        escalated: 2,
        goalsBehindPace: 1,
        attentionWork: 5,
      }),
    }
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo }),
      attention,
      inboxTargets: {
        getGoogleReviewTargetCountsByProperty: async (input) => {
          expect(input).toEqual({
            organizationId: organizationId('org-overview'),
            propertyIds: [propertyId('a0000000-0000-4000-8000-000000000001')],
            now: NOW,
          })
          return new Map([
            [
              propertyId('a0000000-0000-4000-8000-000000000001'),
              { activeCount: 3, overdueCount: 3 },
            ],
          ])
        },
      },
      clock: () => NOW,
    })

    const result = await getOverview({
      organizationId: organizationId('org-overview'),
      propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
      portalId: null,
      startDate: new Date('2026-07-26T12:00:00.000Z'),
      endDate: NOW,
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    expect(result.dashboard.kpis).toBe(repo.kpisOverride)
    expect(result.signals).toEqual({
      overdue: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      ratingDrop: true,
      needsAttention: 6,
    })
    expect(repo.calls.filter((call) => call === 'getKPIs')).toHaveLength(1)
  })
})
