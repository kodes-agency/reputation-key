// Dashboard context — getDashboardData use case unit tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDashboardData } from './get-dashboard-data'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'

const MS_PER_DAY = 86_400_000

// Fixed time to prevent midnight-boundary flakiness in date range calculations
beforeEach(() => vi.setSystemTime(new Date('2025-06-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

const ORG_A = organizationId('org-test')
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')

describe('getDashboardData (use case)', () => {
  it('composes all dashboard sections from repo calls', async () => {
    const now = new Date()
    const startDate = new Date(now.getTime() - 30 * MS_PER_DAY)
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo })

    const result = await getDashboard({
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: null,
      startDate,
      endDate: now,
      timeRange: '30d',
    })

    // All sections present
    expect(result.kpis.reviews.value).toBe(10)
    expect(result.ratingDistribution).toHaveLength(5)
    expect(result.ratingTrend).toHaveLength(2)
    expect(result.reviewVolume).toHaveLength(2)
    expect(result.replyPerformance.replyRate).toBe(66.67)
    expect(result.recentReviews).toHaveLength(1)

    // No portal → no funnel
    expect(result.engagementFunnel).toBeNull()

    // All repo methods called except engagement funnel
    expect(repo.calls).toContain('getKPIs')
    expect(repo.calls).toContain('getRatingDistribution')
    expect(repo.calls).toContain('getRatingTrend')
    expect(repo.calls).toContain('getReviewVolume')
    expect(repo.calls).toContain('getReplyPerformance')
    expect(repo.calls).toContain('getRecentReviews')
    expect(repo.calls).not.toContain('getEngagementFunnel')
  })

  it('includes engagement funnel when portalId is provided', async () => {
    const now = new Date()
    const startDate = new Date(now.getTime() - 30 * MS_PER_DAY)
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo })

    const result = await getDashboard({
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: PORTAL_A,
      startDate,
      endDate: now,
      timeRange: '30d',
    })

    expect(result.engagementFunnel).not.toBeNull()
    expect(result.engagementFunnel!.scans).toBe(100)
    expect(repo.calls).toContain('getEngagementFunnel')
  })
})
