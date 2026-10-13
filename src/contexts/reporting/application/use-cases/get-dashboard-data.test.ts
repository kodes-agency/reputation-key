// Dashboard context — getDashboardData use case unit tests

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDashboardData } from './get-dashboard-data'
import { createInMemoryDashboardRepository } from '#/shared/testing/in-memory-dashboard-repo'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'

const MS_PER_DAY = 86_400_000

// Fixed time to prevent midnight-boundary flakiness in date range calculations
beforeEach(() => vi.setSystemTime(new Date('2025-06-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

const ORG_A = organizationId('org-test')
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')
const ADMIN = buildTestAuthContext({ organizationId: ORG_A, role: 'AccountAdmin' })
const organizationWide = async () => null

describe('getDashboardData (use case)', () => {
  it('composes all dashboard sections from repo calls', async () => {
    const now = new Date()
    const startDate = new Date(now.getTime() - 30 * MS_PER_DAY)
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo, propertyAccess: organizationWide })

    const result = await getDashboard(
      {
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: null,
        startDate,
        endDate: now,
        timeRange: '30d',
        propertyTimezone: 'UTC',
      },
      ADMIN,
    )

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
    const getDashboard = getDashboardData({ repo, propertyAccess: organizationWide })

    const result = await getDashboard(
      {
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        startDate,
        endDate: now,
        timeRange: '30d',
        propertyTimezone: 'UTC',
      },
      ADMIN,
    )

    expect(result.engagementFunnel).not.toBeNull()
    expect(result.engagementFunnel!.scans).toBe(100)
    expect(repo.calls).toContain('getEngagementFunnel')
  })

  it('does not present all-time KPI self-comparisons as real trends', async () => {
    const now = new Date()
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo, propertyAccess: organizationWide })

    const result = await getDashboard(
      {
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: null,
        startDate: new Date(0),
        endDate: now,
        timeRange: 'all',
        propertyTimezone: 'UTC',
      },
      ADMIN,
    )

    expect(result.kpis.reviews.trend).toBeNull()
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.scans.trend).toBeNull()
    expect(result.kpis.feedback.trend).toBeNull()
  })
})

describe('getDashboardData authorization', () => {
  const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
  const manager = buildTestAuthContext({ organizationId: ORG_A, role: 'PropertyManager' })
  const last30Days = () => {
    const endDate = new Date()
    return {
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: null,
      startDate: new Date(endDate.getTime() - 30 * MS_PER_DAY),
      endDate,
      timeRange: '30d' as const,
      propertyTimezone: 'UTC',
    }
  }

  it('refuses a manager with no grant on the Property before anything is read', async () => {
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({
      repo,
      propertyAccess: async () => [OTHER_PROPERTY],
    })

    await expect(getDashboard(last30Days(), manager)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(repo.calls).toEqual([])
  })

  it('refuses a reader who belongs to another Organization', async () => {
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo, propertyAccess: async () => null })
    const foreignAdmin = buildTestAuthContext({
      organizationId: organizationId('org-other'),
      role: 'AccountAdmin',
    })

    await expect(getDashboard(last30Days(), foreignAdmin)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(repo.calls).toEqual([])
  })

  it('serves a manager granted the Property', async () => {
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo, propertyAccess: async () => [PROP_A] })

    const result = await getDashboard(last30Days(), manager)

    expect(result.kpis.reviews.value).toBe(10)
    expect(result.replyPerformance.replyRate).toBe(66.67)
  })

  it('hides reply state from a reader who may not manage replies', async () => {
    const repo = createInMemoryDashboardRepository()
    const getDashboard = getDashboardData({ repo, propertyAccess: async () => null })
    const readOnly = createScopedAuthContext({
      organizationId: ORG_A,
      userId: ADMIN.userId,
      permissions: [['dashboard.read', 'organization']],
    })

    const result = await getDashboard(last30Days(), readOnly)

    expect(result.replyPerformance).toEqual({ replyRate: 0, avgReplyHours: null })
    expect(result.kpis.reviews.value).toBe(10)
  })
})
