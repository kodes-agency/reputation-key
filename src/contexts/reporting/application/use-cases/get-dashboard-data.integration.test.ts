// Dashboard context — getDashboardData use case against real PostgreSQL: the
// Dashboard Repository's Review and Metric reads decide what the reader sees.

import { describe, it, expect } from 'vitest'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { getDb } from '#/shared/db'
import { createServingStats } from '#/contexts/review/infrastructure/serving-stats'
import {
  recordedDashboardRepo,
  seedDashboardMetricReading,
  seedDashboardPortal,
  seedDashboardProperty,
  seedDashboardReview,
} from '../../infrastructure/testing/dashboard-fixtures'
import { getDashboardData } from './get-dashboard-data'

const MS_PER_DAY = 86_400_000
const NOW = new Date('2025-06-15T12:00:00.000Z')

const ORG_A = organizationId('org-dashboard-data-a')
const ORG_B = organizationId('org-dashboard-data-b')
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')
const ADMIN = buildTestAuthContext({ organizationId: ORG_A, role: 'AccountAdmin' })
const organizationWide = async () => null

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['replies', 'reviews', 'metric_readings', 'portals', 'properties'],
})

const last30Days = () => ({
  organizationId: ORG_A,
  propertyId: PROP_A,
  portalId: null,
  startDate: new Date(NOW.getTime() - 30 * MS_PER_DAY),
  endDate: NOW,
  timeRange: '30d' as const,
  propertyTimezone: 'UTC',
})

const seedProperty = () =>
  seedDashboardProperty(getPool(), { id: PROP_A, organizationId: ORG_A })

const review = (daysBefore: number, rating: number, publishedReplyAfterHours?: number) =>
  seedDashboardReview(getPool(), {
    organizationId: ORG_A,
    propertyId: PROP_A,
    now: NOW,
    rating,
    daysBefore,
    publishedReplyAfterHours,
  })

const reading = (
  metricKey: 'portal.scan' | 'portal.rating' | 'portal.review_link_click',
  daysBefore: number,
  portal?: string,
) =>
  seedDashboardMetricReading(getPool(), {
    organizationId: ORG_A,
    propertyId: PROP_A,
    portalId: portal,
    metricKey,
    value: 1,
    now: NOW,
    daysBefore,
  })

/** Three Reviews in the window (two replied), one in the prior window, scans in both. */
const seedActivity = async () => {
  await seedProperty()
  await review(1, 5, 6)
  await review(2, 4, 48)
  await review(3, 3)
  await review(40, 2)
  for (const daysBefore of [1, 2, 3, 4]) await reading('portal.scan', daysBefore)
  for (const daysBefore of [40, 41]) await reading('portal.scan', daysBefore)
}

describe('getDashboardData (use case)', () => {
  it('composes all dashboard sections from the stored Reviews, Replies and Metrics', async () => {
    await seedActivity()
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({ repo, propertyAccess: organizationWide })

    const result = await getDashboard(last30Days(), ADMIN)

    expect(result.kpis.reviews).toEqual({ value: 3, priorValue: 1, trend: 200 })
    expect(result.kpis.scans).toMatchObject({ value: 4, priorValue: 2, trend: 100 })
    expect(result.ratingDistribution).toEqual(
      [1, 2, 3, 4, 5].map((stars) => ({ stars, count: stars >= 3 ? 1 : 0 })),
    )
    expect(result.ratingTrend).toHaveLength(3)
    expect(result.reviewVolume.map((point) => point.count)).toEqual([1, 1, 1])
    expect(result.replyPerformance).toEqual({ replyRate: 66.67, avgReplyHours: 27 })
    expect(result.recentReviews.map((r) => r.rating)).toEqual([5, 4, 3, 2])
    expect(result.recentReviews.map((r) => r.replyStatus)).toEqual([
      'published',
      'published',
      'none',
      'none',
    ])

    // No portal → no funnel, and its read is never issued.
    expect(result.engagementFunnel).toBeNull()
    expect(calls).not.toContain('getEngagementFunnel')
    expect(calls).toEqual(
      expect.arrayContaining([
        'getKPIs',
        'getRatingDistribution',
        'getRatingTrend',
        'getReviewVolume',
        'getReplyPerformance',
        'getRecentReviews',
      ]),
    )
  })

  it('includes the engagement funnel when a portalId is provided', async () => {
    await seedProperty()
    await seedDashboardPortal(getPool(), {
      id: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
    })
    for (const daysBefore of [1, 2, 3]) await reading('portal.scan', daysBefore, PORTAL_A)
    for (const daysBefore of [1, 2, 3, 4, 5])
      await reading('portal.rating', daysBefore, PORTAL_A)
    await reading('portal.review_link_click', 1, PORTAL_A)
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({ repo, propertyAccess: organizationWide })

    const result = await getDashboard({ ...last30Days(), portalId: PORTAL_A }, ADMIN)

    expect(result.engagementFunnel).toEqual({ scans: 3, ratings: 5, reviewLinkClicks: 1 })
    expect(calls).toContain('getEngagementFunnel')
  })

  it('does not present all-time KPI self-comparisons as real trends', async () => {
    await seedActivity()
    const { repo } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({ repo, propertyAccess: organizationWide })

    const result = await getDashboard(
      { ...last30Days(), startDate: new Date(0), timeRange: 'all' },
      ADMIN,
    )

    expect(result.kpis.reviews.value).toBe(4)
    expect(result.kpis.reviews.trend).toBeNull()
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.scans.trend).toBeNull()
    expect(result.kpis.feedback.trend).toBeNull()
  })
})

describe('getDashboardData authorization', () => {
  const manager = buildTestAuthContext({ organizationId: ORG_A, role: 'PropertyManager' })

  it('refuses a manager with no grant on the Property before anything is read', async () => {
    await seedActivity()
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({
      repo,
      propertyAccess: async () => [OTHER_PROPERTY],
    })

    await expect(getDashboard(last30Days(), manager)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(calls).toEqual([])
  })

  it('refuses a reader who belongs to another Organization', async () => {
    await seedActivity()
    const { repo, calls } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({ repo, propertyAccess: async () => null })
    const foreignAdmin = buildTestAuthContext({
      organizationId: ORG_B,
      role: 'AccountAdmin',
    })

    await expect(getDashboard(last30Days(), foreignAdmin)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(calls).toEqual([])
  })

  it('serves a manager granted the Property', async () => {
    await seedActivity()
    const { repo } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({ repo, propertyAccess: async () => [PROP_A] })

    const result = await getDashboard(last30Days(), manager)

    expect(result.kpis.reviews.value).toBe(3)
    expect(result.replyPerformance.replyRate).toBe(66.67)
  })

  it('hides reply state from a reader who may not manage replies', async () => {
    await seedActivity()
    const { repo } = recordedDashboardRepo(
      getDb(),
      createServingStats({ db: getDb(), clock: () => NOW }),
    )
    const getDashboard = getDashboardData({ repo, propertyAccess: async () => null })
    const readOnly = createScopedAuthContext({
      organizationId: ORG_A,
      userId: ADMIN.userId,
      permissions: [['dashboard.read', 'organization']],
    })

    const result = await getDashboard(last30Days(), readOnly)

    expect(result.replyPerformance).toEqual({ replyRate: 0, avgReplyHours: null })
    expect(result.recentReviews.every((r) => r.replyStatus === 'none')).toBe(true)
    expect(result.kpis.reviews.value).toBe(3)
  })
})
