// Dashboard context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { Pool } from 'pg'
import { createDashboardRepository } from '../../infrastructure/repositories/dashboard.repository'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'

const MS_PER_DAY = 86_400_000

const ORG_A = organizationId('org-aaaaaaaaaaaa')
const ORG_B = organizationId('org-bbbbbbbbbbbb')
// Property IDs must be valid UUIDs (Postgres uuid column)
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['reviews', 'replies', 'metric_readings'],
})

/** Helper: seed a property row (FK dependency for reviews). */
async function seedProperty(pool: Pool, propId: string, orgId: string) {
  const slug = 'test-' + propId.slice(0, 8)
  const name = 'Test Property ' + propId.slice(0, 8)
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, $3, $4, 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [propId, orgId, name, slug],
  )
}

/** Helper: seed a review row. Returns the review id. */
async function seedReview(
  pool: Pool,
  overrides: {
    id?: string
    orgId?: string
    propId?: string
    rating?: number
    text?: string
    daysAgo?: number
  } = {},
) {
  const id = overrides.id ?? crypto.randomUUID()
  const orgId = overrides.orgId ?? ORG_A
  const propId = overrides.propId ?? PROP_A
  const rating = overrides.rating ?? 4
  const text = overrides.text ?? 'Review text'
  const reviewedAt = new Date(Date.now() - (overrides.daysAgo ?? 0) * MS_PER_DAY)
  const expiresAt = new Date(reviewedAt.getTime() + 30 * MS_PER_DAY)

  await pool.query(
    `INSERT INTO reviews (id, organization_id, property_id, platform, external_id, external_location_id, rating, text, reviewed_at, expires_at)
     VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, $8, $9)`,
    [id, orgId, propId, `ext-${id}`, `loc-${id}`, rating, text, reviewedAt, expiresAt],
  )
  return id
}

/** Helper: seed a metric reading row. */
async function seedMetricReading(
  pool: Pool,
  overrides: {
    orgId?: string
    propId?: string
    portalId?: string
    metricKey: string
    value: number
    daysAgo?: number
  },
) {
  const id = crypto.randomUUID()
  const orgId = overrides.orgId ?? ORG_A
  const propId = overrides.propId ?? PROP_A
  const recordedAt = new Date(Date.now() - (overrides.daysAgo ?? 0) * MS_PER_DAY)

  await pool.query(
    `INSERT INTO metric_readings (id, organization_id, property_id, portal_id, metric_key, value, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, orgId, propId, overrides.portalId ?? null, overrides.metricKey, overrides.value, recordedAt],
  )
  return id
}

describe('dashboardRepository (integration)', () => {
  describe('getRecentReviews', () => {
    it('returns last N reviews ordered by reviewedAt desc', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      await seedReview(pool, { id: crypto.randomUUID(), rating: 5, text: 'Excellent!', daysAgo: 1 })
      await seedReview(pool, { id: crypto.randomUUID(), rating: 3, text: 'Okay', daysAgo: 3 })
      await seedReview(pool, { id: crypto.randomUUID(), rating: 1, text: 'Terrible', daysAgo: 7 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 5,
      })

      expect(result).toHaveLength(3)
      expect(result[0].rating).toBe(5) // most recent first
      expect(result[0].snippet).toBe('Excellent!')
      expect(result[0].replyStatus).toBe('none')
      expect(result[2].rating).toBe(1)
    })

    it('limits results to the specified limit', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      for (let i = 0; i < 5; i++) {
        await seedReview(pool, { daysAgo: i })
      }

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 2,
      })

      expect(result).toHaveLength(2)
    })

    it('shows replyStatus as published when review has a published reply', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      const reviewId = await seedReview(pool, { rating: 5, text: 'Great!' })

      const now = new Date()
      await pool.query(
        `INSERT INTO replies (id, review_id, organization_id, text, status, source, published_at)
         VALUES ($1, $2, $3, 'Thank you!', 'published', 'internal', $4)`,
        [crypto.randomUUID(), reviewId, ORG_A, now],
      )

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 5,
      })

      expect(result).toHaveLength(1)
      expect(result[0].replyStatus).toBe('published')
    })
  })

  describe('getRatingDistribution', () => {
    it('returns star buckets from reviews in the date range', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Seed reviews with various ratings
      await seedReview(pool, { rating: 5, daysAgo: 1 })
      await seedReview(pool, { rating: 5, daysAgo: 2 })
      await seedReview(pool, { rating: 4, daysAgo: 3 })
      await seedReview(pool, { rating: 3, daysAgo: 5 })
      await seedReview(pool, { rating: 1, daysAgo: 10 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRatingDistribution({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 15 * MS_PER_DAY),
        endDate: new Date(),
      })

      // Should have 5 buckets (1–5)
      expect(result).toHaveLength(5)
      expect(result.find((b) => b.stars === 5)!.count).toBe(2)
      expect(result.find((b) => b.stars === 4)!.count).toBe(1)
      expect(result.find((b) => b.stars === 3)!.count).toBe(1)
      expect(result.find((b) => b.stars === 2)!.count).toBe(0)
      expect(result.find((b) => b.stars === 1)!.count).toBe(1)
    })

    it('excludes reviews outside the date range', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      await seedReview(pool, { rating: 5, daysAgo: 5 }) // inside
      await seedReview(pool, { rating: 1, daysAgo: 20 }) // outside

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRatingDistribution({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 10 * MS_PER_DAY),
        endDate: new Date(),
      })

      expect(result.find((b) => b.stars === 5)!.count).toBe(1)
      expect(result.find((b) => b.stars === 1)!.count).toBe(0)
    })
  })

  describe('getKPIs', () => {
    it('returns review count, avg rating, scan count, and feedback count with prior period trend', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Current period (last 7 days)
      await seedReview(pool, { rating: 5, daysAgo: 1 })
      await seedReview(pool, { rating: 3, daysAgo: 3 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 2 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 5 })
      await seedMetricReading(pool, { metricKey: 'portal.feedback', value: 1, daysAgo: 2 })
      await seedMetricReading(pool, { metricKey: 'portal.feedback', value: 1, daysAgo: 4 })

      // Prior period (7–14 days ago)
      await seedReview(pool, { rating: 4, daysAgo: 10 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 8 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 12 })
      await seedMetricReading(pool, { metricKey: 'portal.feedback', value: 1, daysAgo: 9 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const now = new Date()
      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: null,
        startDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        endDate: now,
        priorStartDate: new Date(now.getTime() - 14 * MS_PER_DAY),
        priorEndDate: new Date(now.getTime() - 7 * MS_PER_DAY),
      })

      // Reviews: 2 current, 1 prior → +100%
      expect(result.reviews.value).toBe(2)
      expect(result.reviews.priorValue).toBe(1)
      expect(result.reviews.trend).toBe(100)

      // Avg rating: current (5+3)/2 = 4, prior 4 → 0%
      expect(result.avgRating.value).toBe(4)
      expect(result.avgRating.priorValue).toBe(4)
      expect(result.avgRating.trend).toBe(0)

      // Scans: 3 current, 2 prior → +50%
      expect(result.scans.value).toBe(3)
      expect(result.scans.priorValue).toBe(2)
      expect(result.scans.trend).toBe(50)

      // Feedback: 2 current, 1 prior → +100%
      expect(result.feedback.value).toBe(2)
      expect(result.feedback.priorValue).toBe(1)
      expect(result.feedback.trend).toBe(100)
    })

    it('returns zero-prior KPIs with null trends when no data in prior period', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Only current period data
      await seedReview(pool, { rating: 5, daysAgo: 1 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, { metricKey: 'portal.feedback', value: 1, daysAgo: 1 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const now = new Date()
      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: null,
        startDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        endDate: now,
        priorStartDate: new Date(now.getTime() - 14 * MS_PER_DAY),
        priorEndDate: new Date(now.getTime() - 7 * MS_PER_DAY),
      })

      expect(result.reviews.value).toBe(1)
      expect(result.reviews.priorValue).toBe(0)
      expect(result.reviews.trend).toBeNull()

      expect(result.avgRating.value).toBe(5)
      expect(result.avgRating.priorValue).toBe(0)
      expect(result.avgRating.trend).toBeNull()

      expect(result.scans.value).toBe(1)
      expect(result.scans.priorValue).toBe(0)
      expect(result.scans.trend).toBeNull()
    })
  })

  describe('getReplyPerformance', () => {
    it('computes reply rate and avg hours from reviewedAt to publishedAt', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // 3 reviews in range. 2 have published replies.
      const r1 = await seedReview(pool, { rating: 5, daysAgo: 1 })
      const r2 = await seedReview(pool, { rating: 4, daysAgo: 2 })
      await seedReview(pool, { rating: 3, daysAgo: 3 }) // no reply

      // Reply to r1: 6 hours after reviewedAt
      const r1Reviewed = new Date(Date.now() - 1 * MS_PER_DAY)
      await pool.query(
        `INSERT INTO replies (id, review_id, organization_id, text, status, source, published_at)
         VALUES ($1, $2, $3, 'Thanks', 'published', 'internal', $4)`,
        [crypto.randomUUID(), r1, ORG_A, new Date(r1Reviewed.getTime() + 6 * 3600000)],
      )

      // Reply to r2: 48 hours after reviewedAt
      const r2Reviewed = new Date(Date.now() - 2 * MS_PER_DAY)
      await pool.query(
        `INSERT INTO replies (id, review_id, organization_id, text, status, source, published_at)
         VALUES ($1, $2, $3, 'Thanks', 'published', 'internal', $4)`,
        [crypto.randomUUID(), r2, ORG_A, new Date(r2Reviewed.getTime() + 48 * 3600000)],
      )

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getReplyPerformance({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 7 * MS_PER_DAY),
        endDate: new Date(),
      })

      // Reply rate: 2/3 ≈ 66.67 → rounded
      expect(Math.round(result.replyRate)).toBe(67)
      // Avg reply hours: (6 + 48) / 2 = 27
      expect(result.avgReplyHours).toBe(27)
    })

    it('returns 0 reply rate and null avg hours when no replies exist', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      await seedReview(pool, { rating: 5, daysAgo: 1 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getReplyPerformance({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 7 * MS_PER_DAY),
        endDate: new Date(),
      })

      expect(result.replyRate).toBe(0)
      expect(result.avgReplyHours).toBeNull()
    })
  })

  describe('getRatingTrend', () => {
    it('returns daily avg rating points', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Day 1: avg (5+3)/2 = 4
      await seedReview(pool, { rating: 5, daysAgo: 2 })
      await seedReview(pool, { rating: 3, daysAgo: 2 })
      // Day 2: avg 1
      await seedReview(pool, { rating: 1, daysAgo: 1 })
      // Day 3: avg 5
      await seedReview(pool, { rating: 5, daysAgo: 0 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRatingTrend({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 5 * MS_PER_DAY),
        endDate: new Date(),
      })

      expect(result.length).toBeGreaterThanOrEqual(3)
      // Check the three days we care about
      const twoDaysAgo = result[result.length - 3]
      expect(twoDaysAgo.avgRating).toBe(4)

      const oneDayAgo = result[result.length - 2]
      expect(oneDayAgo.avgRating).toBe(1)

      const today = result[result.length - 1]
      expect(today.avgRating).toBe(5)
    })
  })

  describe('getReviewVolume', () => {
    it('returns daily review counts', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      await seedReview(pool, { rating: 5, daysAgo: 2 })
      await seedReview(pool, { rating: 4, daysAgo: 2 })
      await seedReview(pool, { rating: 3, daysAgo: 1 })
      await seedReview(pool, { rating: 5, daysAgo: 0 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getReviewVolume({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 5 * MS_PER_DAY),
        endDate: new Date(),
      })

      expect(result.length).toBeGreaterThanOrEqual(3)
      const twoDaysAgo = result[result.length - 3]
      expect(twoDaysAgo.count).toBe(2)

      const oneDayAgo = result[result.length - 2]
      expect(oneDayAgo.count).toBe(1)

      const today = result[result.length - 1]
      expect(today.count).toBe(1)
    })
  })

  describe('getEngagementFunnel', () => {
    it('returns scans, ratings, and review link clicks for a portal', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Seed portal
      await pool.query(
        `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug)
         VALUES ($1, $2, $3, 'property', $3, 'Test Portal', 'test-portal')
         ON CONFLICT (id) DO NOTHING`,
        [PORTAL_A, ORG_A, PROP_A],
      )

      // Seed metric readings for the portal
      await seedMetricReading(pool, { portalId: PORTAL_A, metricKey: 'portal.scan', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, { portalId: PORTAL_A, metricKey: 'portal.scan', value: 1, daysAgo: 2 })
      await seedMetricReading(pool, { portalId: PORTAL_A, metricKey: 'portal.scan', value: 1, daysAgo: 3 })
      await seedMetricReading(pool, { portalId: PORTAL_A, metricKey: 'portal.feedback', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, { portalId: PORTAL_A, metricKey: 'portal.feedback', value: 1, daysAgo: 2 })
      await seedMetricReading(pool, { portalId: PORTAL_A, metricKey: 'portal.review_link_click', value: 1, daysAgo: 1 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getEngagementFunnel({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        startDate: new Date(Date.now() - 7 * MS_PER_DAY),
        endDate: new Date(),
      })

      expect(result.scans).toBe(3)
      expect(result.ratings).toBe(2) // feedback_submitted
      expect(result.reviewLinkClicks).toBe(1)
    })
  })

  describe('tenant isolation', () => {
    it('getRecentReviews cannot see data from another org', async () => {
      const pool = getPool()

      // Seed properties for both orgs
      const PROP_B = propertyId('b0000000-0000-0000-0000-000000000001')
      await seedProperty(pool, PROP_A, ORG_A)
      await seedProperty(pool, PROP_B, ORG_B)

      // Reviews for both orgs
      await seedReview(pool, { propId: PROP_A, orgId: ORG_A, rating: 5, daysAgo: 1 })
      await seedReview(pool, { propId: PROP_B, orgId: ORG_B, rating: 1, daysAgo: 1 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 10,
      })

      expect(result).toHaveLength(1)
      expect(result[0].rating).toBe(5) // Only ORG_A's review
    })

    it('getKPIs cannot see metric readings from another org', async () => {
      const pool = getPool()
      const PROP_B = propertyId('b0000000-0000-0000-0000-000000000001')
      await seedProperty(pool, PROP_A, ORG_A)
      await seedProperty(pool, PROP_B, ORG_B)

      await seedMetricReading(pool, { orgId: ORG_A, propId: PROP_A, metricKey: 'portal.scan', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, { orgId: ORG_B, propId: PROP_B, metricKey: 'portal.scan', value: 1, daysAgo: 1 })

      const db = getDb()
      const repo = createDashboardRepository(db)
      const now = new Date()
      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: null,
        startDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        endDate: now,
        priorStartDate: new Date(now.getTime() - 14 * MS_PER_DAY),
        priorEndDate: new Date(now.getTime() - 7 * MS_PER_DAY),
      })

      // Only 1 scan from ORG_A
      expect(result.scans.value).toBe(1)
    })
  })
})
