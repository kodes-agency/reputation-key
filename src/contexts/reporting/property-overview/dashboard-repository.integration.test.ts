// Dashboard context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { Pool } from 'pg'
import { createDashboardRepository } from './dashboard-repository.server'
import { createServingStats } from '#/contexts/reputation/reviews/serving-stats.server'
import { getDb, type Database } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId } from '#/shared/domain/ids'

const MS_PER_DAY = 86_400_000

// BQC-5.5: review stats come from the review-owned governed serving
// implementation (what composition wires into the dashboard build).
const createReviewStats = (db: Database) =>
  createServingStats({ db, clock: () => new Date() })

const ORG_A = organizationId('org-aaaaaaaaaaaa')
const ORG_B = organizationId('org-bbbbbbbbbbbb')
// Property IDs must be valid UUIDs (Postgres uuid column)
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  // Child rows must be removed before their Review parents now that reply
  // history is deliberately retained with a restrictive foreign key.
  tables: ['replies', 'reviews'],
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
    contentExpiresAt?: Date | null
  } = {},
) {
  const id = overrides.id ?? crypto.randomUUID()
  const orgId = overrides.orgId ?? ORG_A
  const propId = overrides.propId ?? PROP_A
  const rating = overrides.rating ?? 4
  const text = overrides.text ?? 'Review text'
  const reviewedAt = new Date(Date.now() - (overrides.daysAgo ?? 0) * MS_PER_DAY)
  const expiresAt = new Date(reviewedAt.getTime() + 30 * MS_PER_DAY)

  const contentExpiresAt =
    // BQC-1.4: serving reads require eligible content — seed a live fetch clock.
    overrides.contentExpiresAt === undefined
      ? new Date(Date.now() + 30 * MS_PER_DAY)
      : overrides.contentExpiresAt

  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       expires_at, first_fetched_at, source_epoch, source_revision, analysis_sequence
     )
     VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, 0, 0, 0)`,
    [id, orgId, propId, `ext-${id}`, `loc-${id}`, expiresAt, reviewedAt],
  )
  // A Review without a content clock holds no content row.
  if (contentExpiresAt === null) return id
  await pool.query(
    `INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, text, reviewed_at, first_fetched_at,
       last_fetched_at, content_expires_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     )
     VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, $8, $8, $8, $9, 0, 0, 1,
             repeat('0', 64))`,
    [
      id,
      orgId,
      propId,
      `ext-${id}`,
      `loc-${id}`,
      rating,
      text,
      reviewedAt,
      contentExpiresAt,
    ],
  )
  return id
}

/** Helper: seed a reply row on a review. */
async function seedReply(
  pool: Pool,
  reviewId: string,
  reply: { status: string; publishedAt: Date | null },
) {
  await pool.query(
    `INSERT INTO replies (id, review_id, organization_id, text, status, source, published_at)
     VALUES ($1, $2, $3, 'Thanks', $4, 'internal', $5)`,
    [crypto.randomUUID(), reviewId, ORG_A, reply.status, reply.publishedAt],
  )
}

const realRepo = () => {
  return createDashboardRepository(createReviewStats(getDb()))
}

describe('dashboardRepository (integration)', () => {
  describe('getRecentReviews', () => {
    it('returns last N reviews ordered by reviewedAt desc', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      await seedReview(pool, {
        id: crypto.randomUUID(),
        rating: 5,
        text: 'Excellent!',
        daysAgo: 1,
      })
      await seedReview(pool, {
        id: crypto.randomUUID(),
        rating: 3,
        text: 'Okay',
        daysAgo: 3,
      })
      await seedReview(pool, {
        id: crypto.randomUUID(),
        rating: 1,
        text: 'Terrible',
        daysAgo: 7,
      })

      const repo = realRepo()
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

      const repo = realRepo()
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 2,
      })

      expect(result).toHaveLength(2)
    })

    it.each([
      [
        'shows replyStatus as published when review has a published reply',
        { rating: 5, text: 'Great!' },
        { status: 'published', publishedAt: new Date() },
        'published',
      ],
      [
        'shows replyStatus as none when reply is rejected',
        { rating: 3, text: 'Meh' },
        { status: 'rejected', publishedAt: null },
        'none',
      ],
    ] as const)('%s', async (_title, review, reply, expected) => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      const reviewId = await seedReview(pool, review)
      await seedReply(pool, reviewId, reply)

      const result = await realRepo().getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 5,
      })

      expect(result).toHaveLength(1)
      expect(result[0].replyStatus).toBe(expected)
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

      const repo = realRepo()
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

      const repo = realRepo()
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
    it('returns review count and avg rating with prior period trend', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Current period (last 7 days)
      await seedReview(pool, { rating: 5, daysAgo: 1 })
      await seedReview(pool, { rating: 3, daysAgo: 3 })

      // Prior period (7–14 days ago)
      await seedReview(pool, { rating: 4, daysAgo: 10 })

      const repo = realRepo()
      const now = new Date()
      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        endDate: now,
        comparisonPeriod: {
          priorStartDate: new Date(now.getTime() - 14 * MS_PER_DAY),
          priorEndDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        },
      })

      // Reviews: 2 current, 1 prior → +100%
      expect(result.reviews.value).toBe(2)
      expect(result.reviews.priorValue).toBe(1)
      expect(result.reviews.trend).toBe(100)

      // Avg rating: current (5+3)/2 = 4, prior 4; both periods are below the
      // ten-rating comparison floor, so no star delta is presented.
      expect(result.avgRating.value).toBe(4)
      expect(result.avgRating.priorValue).toBe(4)
      expect(result.avgRating.comparison).toBeNull()
      expect(result.avgRating.sampleCount).toBe(2)
      expect(result.avgRating.priorSampleCount).toBe(1)
      expect(result.avgRating.evidence).toMatchObject({
        state: 'ready',
        sampleCount: 2,
      })
    })

    it('does not turn a missing prior review period into a zero comparison', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Only current period data
      await seedReview(pool, { rating: 5, daysAgo: 1 })

      const repo = realRepo()
      const now = new Date()
      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        endDate: now,
        comparisonPeriod: {
          priorStartDate: new Date(now.getTime() - 14 * MS_PER_DAY),
          priorEndDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        },
      })

      expect(result.reviews.value).toBe(1)
      expect(result.reviews.priorValue).toBe(0)
      expect(result.reviews.trend).toBeNull()

      expect(result.avgRating.value).toBe(5)
      expect(result.avgRating.priorValue).toBeNull()
      expect(result.avgRating.comparison).toBeNull()
      expect(result.avgRating.sampleCount).toBe(1)
      expect(result.avgRating.priorSampleCount).toBe(0)
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
      await seedReply(pool, r1, {
        status: 'published',
        publishedAt: new Date(r1Reviewed.getTime() + 6 * 3600000),
      })

      // Reply to r2: 48 hours after reviewedAt
      const r2Reviewed = new Date(Date.now() - 2 * MS_PER_DAY)
      await seedReply(pool, r2, {
        status: 'published',
        publishedAt: new Date(r2Reviewed.getTime() + 48 * 3600000),
      })

      const repo = realRepo()
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

      const repo = realRepo()
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

      const repo = realRepo()
      // The repository's period end is exclusive. Advance by one millisecond
      // so the newest fixture is strictly inside the window even when the
      // JavaScript clock has not ticked since seedReview captured Date.now().
      const endDate = new Date(Date.now() + 1)
      const result = await repo.getRatingTrend({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 5 * MS_PER_DAY),
        endDate,
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

      const repo = realRepo()
      // The repository's period end is exclusive; keep the newest fixture
      // strictly inside the window when both timestamps share a millisecond.
      const endDate = new Date(Date.now() + 1)
      const result = await repo.getReviewVolume({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(Date.now() - 5 * MS_PER_DAY),
        endDate,
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

      const repo = realRepo()
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 10,
      })

      expect(result).toHaveLength(1)
      expect(result[0].rating).toBe(5) // Only ORG_A's review
    })

    it('getKPIs cannot see reviews from another org', async () => {
      const pool = getPool()
      const PROP_B = propertyId('b0000000-0000-0000-0000-000000000001')
      await seedProperty(pool, PROP_A, ORG_A)
      await seedProperty(pool, PROP_B, ORG_B)

      await seedReview(pool, { propId: PROP_A, orgId: ORG_A, rating: 5, daysAgo: 1 })
      await seedReview(pool, { propId: PROP_B, orgId: ORG_B, rating: 1, daysAgo: 1 })

      const repo = realRepo()
      const now = new Date()
      const result = await repo.getKPIs({
        organizationId: ORG_A,
        propertyId: PROP_A,
        startDate: new Date(now.getTime() - 7 * MS_PER_DAY),
        endDate: now,
        comparisonPeriod: null,
      })

      expect(result.reviews.value).toBe(1)
      expect(result.avgRating.value).toBe(5)
    })
  })
})
