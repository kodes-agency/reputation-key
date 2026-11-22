// Dashboard repository — Metric facade behaviour against stubbed ports.

import { describe, it, expect, vi } from 'vitest'
import { createDashboardRepository } from './dashboard-repository.server'
import type { ReviewStatsPort } from './review-stats.port.server'
import type { MetricStatsPort } from './metric-stats.port.server'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../readings/contracts'

const ORG_A = organizationId('org-aaaaaaaaaaaa')
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')

const stubReviewStats = (getPeriodStats: ReturnType<typeof vi.fn>) =>
  ({
    getPeriodStats,
    getRatingDistribution: vi.fn(),
    getRatingTrend: vi.fn(),
    getReviewVolume: vi.fn(),
    getReplyPerformance: vi.fn(),
    getRecentReviews: vi.fn(),
  }) as unknown as ReviewStatsPort

const stubMetricStats = (overrides: Partial<Record<keyof MetricStatsPort, unknown>>) =>
  ({
    getSumsByPeriod: vi.fn(),
    getSumsByPortal: vi.fn(),
    getSumsByPortals: vi.fn(),
    getCountsByPortal: vi.fn(),
    ...overrides,
  }) as unknown as MetricStatsPort

describe('dashboardRepository (stubbed ports)', () => {
  describe('getKPIs', () => {
    it('marks missing Metric rows as insufficient data without manufacturing zero values or trends', async () => {
      const getPeriodStats = vi.fn().mockResolvedValue({ count: 2, avgRating: 4.5 })
      const getSumsByPeriod = vi
        .fn()
        .mockResolvedValueOnce([
          {
            metricKey: 'portal.scan',
            total: 3,
            state: 'available',
            definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
            sampleCount: 3,
            minimumSample: 1,
          },
        ])
        .mockResolvedValueOnce([])
      const repo = createDashboardRepository(
        stubReviewStats(getPeriodStats),
        stubMetricStats({ getSumsByPeriod }),
      )

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

      expect(result.scans).toEqual({
        value: 3,
        priorValue: null,
        trend: null,
        evidence: {
          current: {
            state: 'ready',
            definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
            sampleCount: 3,
            minimumSample: 1,
          },
          prior: {
            state: 'insufficient_data',
            definitionVersionId: null,
            sampleCount: 0,
            minimumSample: null,
          },
        },
      })
      expect(result.feedback).toEqual({
        value: null,
        priorValue: null,
        trend: null,
        evidence: {
          current: {
            state: 'insufficient_data',
            definitionVersionId: null,
            sampleCount: 0,
            minimumSample: null,
          },
          prior: {
            state: 'insufficient_data',
            definitionVersionId: null,
            sampleCount: 0,
            minimumSample: null,
          },
        },
      })
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

    it('skips prior reads and marks trends unavailable without a comparison period', async () => {
      const getPeriodStats = vi.fn().mockResolvedValue({ count: 2, avgRating: 4.5 })
      const getSumsByPeriod = vi.fn().mockResolvedValue([
        {
          metricKey: 'portal.scan',
          total: 3,
          state: 'available',
          definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
          sampleCount: 3,
          minimumSample: 1,
        },
        {
          metricKey: 'portal.feedback',
          total: 5,
          state: 'available',
          definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
          sampleCount: 5,
          minimumSample: 5,
        },
      ])
      const repo = createDashboardRepository(
        stubReviewStats(getPeriodStats),
        stubMetricStats({ getSumsByPeriod }),
      )

      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(0),
        endDate: new Date(),
        comparisonPeriod: null,
      })

      expect(getPeriodStats).toHaveBeenCalledOnce()
      expect(getSumsByPeriod).toHaveBeenCalledOnce()
      expect(result.reviews).toEqual({ value: 2, priorValue: 0, trend: null })
      expect(result.scans.value).toBe(3)
      expect(result.scans.priorValue).toBeNull()
      expect(result.scans.trend).toBeNull()
      expect(result.scans.evidence.prior).toBeNull()
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

  describe('getEngagementFunnel', () => {
    it('withholds the funnel while any governed metric family is not available', async () => {
      const repo = createDashboardRepository(
        {} as ReviewStatsPort,
        stubMetricStats({
          getCountsByPortal: vi.fn().mockResolvedValue([
            {
              metricKey: 'portal.scan',
              count: 3,
              state: 'available',
              definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
              sampleCount: 3,
              minimumSample: 1,
            },
            {
              metricKey: 'portal.rating',
              count: null,
              state: 'insufficient_data',
              definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
              sampleCount: 0,
              minimumSample: 5,
            },
            {
              metricKey: 'portal.review_link_click',
              count: 1,
              state: 'available',
              definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
              sampleCount: 1,
              minimumSample: 1,
            },
          ]),
        }),
      )

      const result = await repo.getEngagementFunnel({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-09-01T00:00:00.000Z'),
      })

      expect(result).toBeNull()
    })
  })
})
