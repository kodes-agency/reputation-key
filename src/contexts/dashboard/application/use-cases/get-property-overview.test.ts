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
      state: 'available',
      definitionVersionId: 'overview-current',
      sampleCount: value,
      minimumSample: 1,
    },
    prior: {
      state: 'available',
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
      avgRating: { value: 4, priorValue: 4.4, trend: -9 },
      scans: metricKpi(100, 80, 25),
      feedback: metricKpi(20, 15, 33),
    }
    const attention: AttentionSignalsPort = {
      getAttentionCounts: async () => ({
        unanswered: 3,
        itemsToTriage: 4,
        escalated: 2,
        goalsBehindPace: 1,
        attentionWork: 5,
      }),
    }
    const getOverview = getPropertyOverview({
      getDashboardData: getDashboardData({ repo }),
      attention,
    })

    const result = await getOverview({
      organizationId: organizationId('org-overview'),
      propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
      portalId: null,
      slaHours: 48,
      startDate: new Date('2026-07-26T12:00:00.000Z'),
      endDate: NOW,
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    expect(result.dashboard.kpis).toBe(repo.kpisOverride)
    expect(result.signals).toEqual({
      unanswered: 3,
      itemsToTriage: 4,
      escalated: 2,
      goalsBehindPace: 1,
      ratingDrop: true,
      needsAttention: 6,
    })
    expect(repo.calls.filter((call) => call === 'getKPIs')).toHaveLength(1)
  })
})
