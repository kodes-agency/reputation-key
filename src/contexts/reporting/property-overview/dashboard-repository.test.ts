// Dashboard repository — KPI assembly against a stubbed Review stats port.

import { describe, it, expect, vi } from 'vitest'
import { createDashboardRepository } from './dashboard-repository.server'
import type { ReviewStatsPort } from './review-stats.port.server'
import { organizationId, propertyId } from '#/shared/domain/ids'

const ORG_A = organizationId('org-aaaaaaaaaaaa')
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')

const stubReviewStats = (getPeriodStats: ReturnType<typeof vi.fn>) =>
  ({
    getPeriodStats,
    getRatingDistribution: vi.fn(),
    getRatingTrend: vi.fn(),
    getReviewVolume: vi.fn(),
    getReplyPerformance: vi.fn(),
    getRecentReviews: vi.fn(),
  }) as unknown as ReviewStatsPort

describe('dashboardRepository (stubbed ports)', () => {
  describe('getKPIs', () => {
    it('compares Review count and average rating with the prior period', async () => {
      const getPeriodStats = vi.fn().mockResolvedValue({ count: 2, avgRating: 4.5 })
      const repo = createDashboardRepository(stubReviewStats(getPeriodStats))

      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-09-01T00:00:00.000Z'),
        comparisonPeriod: {
          priorStartDate: new Date('2026-07-01T00:00:00.000Z'),
          priorEndDate: new Date('2026-08-01T00:00:00.000Z'),
        },
      })

      expect(Object.keys(result).sort()).toEqual(['avgRating', 'reviews'])
      expect(result.reviews).toEqual({ value: 2, priorValue: 2, trend: 0 })
      expect(result.avgRating).toMatchObject({
        value: 4.5,
        priorValue: 4.5,
        comparison: null,
        sampleCount: 2,
        priorSampleCount: 2,
        evidence: {
          state: 'ready',
          sampleCount: 2,
        },
      })
    })

    it('skips the prior read and marks trends unavailable without a comparison period', async () => {
      const getPeriodStats = vi.fn().mockResolvedValue({ count: 2, avgRating: 4.5 })
      const repo = createDashboardRepository(stubReviewStats(getPeriodStats))

      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(0),
        endDate: new Date(),
        comparisonPeriod: null,
      })

      expect(getPeriodStats).toHaveBeenCalledOnce()
      expect(result.reviews).toEqual({ value: 2, priorValue: 0, trend: null })
      expect(result.avgRating).toMatchObject({
        value: 4.5,
        priorValue: null,
        comparison: null,
        sampleCount: 2,
        priorSampleCount: 0,
        evidence: {
          state: 'ready',
          sampleCount: 2,
        },
      })
    })
  })
})
