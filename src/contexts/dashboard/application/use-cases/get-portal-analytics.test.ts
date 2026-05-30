// Dashboard context — getPortalAnalytics use case unit tests
import { describe, it, expect } from 'vitest'
import { getPortalAnalytics } from './get-portal-analytics'
import type { PortalMetricsPort } from '../ports/portal-metrics.port'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import type { PortalAnalyticsData } from '../../domain/types'

const ORG = organizationId('org-test')
const PROP = propertyId('a0000000-0000-0000-0000-000000000001')
const PORT = portalId('b0000000-0000-0000-0000-000000000001')

function createFakePortalMetrics(overrides?: {
  kpiSums?: ReturnType<PortalMetricsPort['getPortalKpiSums']> extends Promise<infer T> ? T : never
  ratingDistribution?: ReturnType<PortalMetricsPort['getPortalRatingDistribution']> extends Promise<infer T> ? T : never
  ratingTrend?: ReturnType<PortalMetricsPort['getPortalRatingTrend']> extends Promise<infer T> ? T : never
}): PortalMetricsPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getPortalKpiSums() {
      calls.push('getPortalKpiSums')
      return overrides?.kpiSums ?? [
        { metricKey: 'portal.scan', total: 100, count: 10 },
        { metricKey: 'portal.feedback', total: 20, count: 5 },
        { metricKey: 'portal.rating', total: 22, count: 5 },
        { metricKey: 'portal.review_link_click', total: 8, count: 3 },
      ]
    },
    async getPortalRatingDistribution() {
      calls.push('getPortalRatingDistribution')
      return overrides?.ratingDistribution ?? [
        { stars: 5, count: 6 },
        { stars: 4, count: 3 },
      ]
    },
    async getPortalRatingTrend() {
      calls.push('getPortalRatingTrend')
      return overrides?.ratingTrend ?? [
        { date: '2026-05-19', avgRating: 4.2 },
        { date: '2026-05-20', avgRating: 4.5 },
      ]
    },
  }
}

describe('getPortalAnalytics (use case)', () => {
  it('composes portal KPI sums into PortalAnalyticsData', async () => {
    const repo = createInMemoryDashboardRepository()
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({ repo, portalMetrics: metrics })
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 86_400_000)

    const result: PortalAnalyticsData = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: start,
      endDate: now,
      timeRange: '30d',
    })

    // KPIs have correct values from fake data
    expect(result.kpis.scans.value).toBe(100)
    expect(result.kpis.scans.priorValue).toBe(100) // Same fake data for prior
    expect(result.kpis.feedback.value).toBe(20)
    expect(result.kpis.avgRating.value).toBe(4.4) // 22/5 = 4.4

    // Engagement funnel from repo
    expect(result.engagementFunnel.scans).toBe(100)
    expect(repo.calls).toContain('getEngagementFunnel')

    // Rating data from metrics port
    expect(result.ratingDistribution).toHaveLength(2)
    expect(result.ratingTrend).toHaveLength(2)
    expect(metrics.calls).toContain('getPortalKpiSums')
  })

  it('handles zero metric values gracefully', async () => {
    const repo = createInMemoryDashboardRepository()
    const metrics = createFakePortalMetrics({
      kpiSums: [
        { metricKey: 'portal.scan', total: 0, count: 0 },
        { metricKey: 'portal.feedback', total: 0, count: 0 },
        { metricKey: 'portal.rating', total: 0, count: 0 },
        { metricKey: 'portal.review_link_click', total: 0, count: 0 },
      ],
    })
    const analytics = getPortalAnalytics({ repo, portalMetrics: metrics })
    const now = new Date()

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: now,
      timeRange: 'all',
    })

    expect(result.kpis.scans.value).toBe(0)
    expect(result.kpis.scans.trend).toBeNull() // prior is 0 → null trend
    expect(result.kpis.avgRating.value).toBe(0)
  })

  it('computes trends when prior period has different values', async () => {
    const repo = createInMemoryDashboardRepository()
    let callCount = 0
    const metrics = createFakePortalMetrics()
    // Build dynamic metrics port that returns different values based on call count
    const dynamicMetrics: PortalMetricsPort & { calls: string[] } = {
      ...metrics,
      async getPortalKpiSums() {
        metrics.calls.push('getPortalKpiSums')
        callCount++
        if (callCount === 1) {
          return [
            { metricKey: 'portal.scan', total: 200, count: 20 },
            { metricKey: 'portal.feedback', total: 40, count: 10 },
            { metricKey: 'portal.rating', total: 45, count: 10 },
            { metricKey: 'portal.review_link_click', total: 16, count: 6 },
          ]
        }
        return [
          { metricKey: 'portal.scan', total: 100, count: 10 },
          { metricKey: 'portal.feedback', total: 20, count: 5 },
          { metricKey: 'portal.rating', total: 20, count: 5 },
          { metricKey: 'portal.review_link_click', total: 8, count: 3 },
        ]
      },
    }

    const analytics = getPortalAnalytics({ repo, portalMetrics: dynamicMetrics })
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 86_400_000)

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: start,
      endDate: now,
      timeRange: '30d',
    })

    // Trend: (200-100)/100 * 100 = 100%
    expect(result.kpis.scans.value).toBe(200)
    expect(result.kpis.scans.priorValue).toBe(100)
    expect(result.kpis.scans.trend).toBe(100)

    // Trend: (4.5 - 4.0) / 4.0 * 100 = 12.5 → 13
    expect(result.kpis.avgRating.value).toBe(4.5)
    expect(result.kpis.avgRating.priorValue).toBe(4)
    expect(result.kpis.avgRating.trend).toBe(13)
  })

  it('includes engagement funnel from repo with default values', async () => {
    const repo = createInMemoryDashboardRepository()
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({ repo, portalMetrics: metrics })
    const now = new Date()

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: now,
      timeRange: 'all',
    })

    expect(result.engagementFunnel.scans).toBe(100) // default from in-memory repo
    expect(result.engagementFunnel.ratings).toBe(40)
    expect(result.engagementFunnel.reviewLinkClicks).toBe(10)
    expect(repo.calls).toContain('getEngagementFunnel')
  })
})
