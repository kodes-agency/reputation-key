// Dashboard context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation is NON-NEGOTIABLE.

import { describe, it, expect, vi } from 'vitest'
import { Pool } from 'pg'
import { createDashboardRepository } from '../../infrastructure/repositories/dashboard.repository'
import { createServingStats } from '#/contexts/review/infrastructure/serving-stats'
import { createMetricStatsAdapter } from '../../infrastructure/adapters/metric-stats.adapter'
import type { ReviewStatsPort } from '../../application/ports/review-stats.port'
import type { MetricStatsPort } from '../../application/ports/metric-stats.port'
import { getDb, type Database } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'

const MS_PER_DAY = 86_400_000

// BQC-5.5: review stats come from the review-owned governed serving
// implementation (what composition wires into the dashboard build).
const createReviewStats = (db: Database) =>
  createServingStats({ db, clock: () => new Date() })

const ORG_A = organizationId('org-aaaaaaaaaaaa')
const ORG_B = organizationId('org-bbbbbbbbbbbb')
// Property IDs must be valid UUIDs (Postgres uuid column)
const PROP_A = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  // Child rows must be removed before their Review parents now that reply
  // history is deliberately retained with a restrictive foreign key.
  tables: ['replies', 'reviews', 'metric_readings'],
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

  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       rating, text, reviewed_at, expires_at, content_expires_at,
       source_epoch, source_revision, analysis_sequence,
       ai_source_byte_length, ai_source_digest
     )
     VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, $8, $9, $10, 0, 0, 0, 1, repeat('0', 64))`,
    [
      id,
      orgId,
      propId,
      `ext-${id}`,
      `loc-${id}`,
      rating,
      text,
      reviewedAt,
      expiresAt,
      // BQC-1.4: serving reads require eligible content — seed a live fetch clock.
      overrides.contentExpiresAt === undefined
        ? new Date(Date.now() + 30 * MS_PER_DAY)
        : overrides.contentExpiresAt,
    ],
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
  const occurredAt = new Date(Date.now() - (overrides.daysAgo ?? 0) * MS_PER_DAY)
  const metricContract = {
    'portal.scan': {
      definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
      sourcePolicy: 'review_solicitation_analytics_only',
    },
    'portal.rating': {
      definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
      sourcePolicy: 'first_party_guest_private',
    },
    'portal.feedback': {
      definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
      sourcePolicy: 'first_party_guest_private',
    },
    'portal.review_link_click': {
      definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
      sourcePolicy: 'review_solicitation_analytics_only',
    },
  }[overrides.metricKey]
  if (!metricContract)
    throw new Error(`Uncatalogued dashboard metric: ${overrides.metricKey}`)

  // event_at is the guest-action time the dashboard window filters on;
  // recorded_at is ingestion. Production writes both (metric-command-store.ts),
  // and the fixture has no outbox lag, so they coincide here.
  await pool.query(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, portal_id, metric_key, value,
       recorded_at, event_at, definition_version_id, source_event_id,
       source_policy, exact_value, sample_count, attribution_quality,
       property_local_date, data_quality, retention_class
     ) VALUES (
       $1, $2, $3, $4, $5, $6::real,
       $7, $7, $8, $9,
       $10, $6::numeric, 1, 'exact',
       $11, 'exact', 'standard'
     )`,
    [
      id,
      orgId,
      propId,
      overrides.portalId ?? null,
      overrides.metricKey,
      overrides.value,
      occurredAt,
      metricContract.definitionVersionId,
      `dashboard-fixture:${id}`,
      metricContract.sourcePolicy,
      occurredAt.toISOString().slice(0, 10),
    ],
  )
  return id
}

describe('dashboardRepository (integration)', () => {
  describe('governed Metric facade', () => {
    it('pins source policy and applies only the current append-only correction tip', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)
      const readingId = await seedMetricReading(pool, {
        metricKey: 'portal.scan',
        value: 1,
        daysAgo: 1,
      })
      const occurredAt = new Date(Date.now() - MS_PER_DAY)

      await pool.query(
        `INSERT INTO metric_readings (
           id, organization_id, property_id, metric_key, value, recorded_at, event_at
         ) VALUES ($1, $2, $3, 'portal.scan', 100, $4, $4)`,
        [crypto.randomUUID(), ORG_A, PROP_A, occurredAt],
      )
      await pool.query(
        `INSERT INTO metric_readings (
           id, organization_id, property_id, metric_key, value,
           recorded_at, event_at, definition_version_id, source_event_id,
           source_policy, exact_value, sample_count, attribution_quality,
           property_local_date, data_quality, retention_class
         ) VALUES (
           $1, $2, $3, 'portal.feedback', 50,
           $4, $4, $5, $6,
           'review_solicitation_analytics_only', 50, 1, 'exact',
           $7, 'exact', 'standard'
         )`,
        [
          crypto.randomUUID(),
          ORG_A,
          PROP_A,
          occurredAt,
          METRIC_VERSION_IDS.portalFeedbackAnalytics,
          `dashboard-wrong-source:${crypto.randomUUID()}`,
          occurredAt.toISOString().slice(0, 10),
        ],
      )

      try {
        const firstCorrectionId = crypto.randomUUID()
        await pool.query(
          `INSERT INTO metric_corrections (
             id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
             replacement_value, event_at
           ) VALUES ($1, $2, $3, 'replace', 'source correction', 'system',
                     'dashboard-test', 10, $4)`,
          [
            firstCorrectionId,
            readingId,
            `dashboard-correction:${crypto.randomUUID()}`,
            occurredAt,
          ],
        )
        await pool.query(
          `INSERT INTO metric_corrections (
             id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
             exact_delta, event_at, supersedes_correction_id
           ) VALUES ($1, $2, $3, 'adjust', 'latest correction', 'system',
                     'dashboard-test', 2, $4, $5)`,
          [
            crypto.randomUUID(),
            readingId,
            `dashboard-correction:${crypto.randomUUID()}`,
            occurredAt,
            firstCorrectionId,
          ],
        )

        const rows = await createMetricStatsAdapter(getDb()).getSumsByPeriod(
          ORG_A,
          PROP_A,
          new Date(Date.now() - 7 * MS_PER_DAY),
          new Date(),
        )

        expect(rows.find(({ metricKey }) => metricKey === 'portal.scan')).toEqual({
          metricKey: 'portal.scan',
          total: 3,
          state: 'available',
          definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
          sampleCount: 1,
          minimumSample: 1,
        })
        expect(rows.find(({ metricKey }) => metricKey === 'portal.feedback')).toEqual({
          metricKey: 'portal.feedback',
          total: null,
          state: 'unavailable',
          definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
          sampleCount: 0,
          minimumSample: 5,
        })
        expect(rows.find(({ metricKey }) => metricKey === 'portal.rating')).toEqual({
          metricKey: 'portal.rating',
          total: null,
          state: 'updating',
          definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
          sampleCount: 0,
          minimumSample: 5,
        })
      } finally {
        await pool.query('DELETE FROM metric_corrections WHERE reading_id = $1', [
          readingId,
        ])
      }
    })
  })

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

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 5,
      })

      expect(result).toHaveLength(1)
      expect(result[0].replyStatus).toBe('published')
    })

    it('shows replyStatus as none when reply is rejected', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      const reviewId = await seedReview(pool, { rating: 3, text: 'Meh' })
      await pool.query(
        `INSERT INTO replies (id, review_id, organization_id, text, status, source)
         VALUES ($1, $2, $3, 'Rejected reply', 'rejected', 'internal')`,
        [crypto.randomUUID(), reviewId, ORG_A],
      )

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
      const result = await repo.getRecentReviews({
        organizationId: ORG_A,
        propertyId: PROP_A,
        limit: 5,
      })

      expect(result).toHaveLength(1)
      expect(result[0].replyStatus).toBe('none')
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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
    it('preserves missing Metric evidence instead of manufacturing zero values or trends', async () => {
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
        {
          getPeriodStats,
          getRatingDistribution: vi.fn(),
          getRatingTrend: vi.fn(),
          getReviewVolume: vi.fn(),
          getReplyPerformance: vi.fn(),
          getRecentReviews: vi.fn(),
        } as unknown as ReviewStatsPort,
        {
          getSumsByPeriod,
          getSumsByPortal: vi.fn(),
          getSumsByPortals: vi.fn(),
          getCountsByPortal: vi.fn(),
        } as unknown as MetricStatsPort,
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
            state: 'updating',
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
            state: 'updating',
            definitionVersionId: null,
            sampleCount: 0,
            minimumSample: null,
          },
          prior: {
            state: 'updating',
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
        {
          getPeriodStats,
          getRatingDistribution: vi.fn(),
          getRatingTrend: vi.fn(),
          getReviewVolume: vi.fn(),
          getReplyPerformance: vi.fn(),
          getRecentReviews: vi.fn(),
        } as unknown as ReviewStatsPort,
        {
          getSumsByPeriod,
          getSumsByPortal: vi.fn(),
          getSumsByPortals: vi.fn(),
          getCountsByPortal: vi.fn(),
        } as unknown as MetricStatsPort,
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

    it('returns review count, avg rating, scan count, and feedback count with prior period trend', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Current period (last 7 days)
      await seedReview(pool, { rating: 5, daysAgo: 1 })
      await seedReview(pool, { rating: 3, daysAgo: 3 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 2 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 5 })
      await seedMetricReading(pool, {
        metricKey: 'portal.feedback',
        value: 1,
        daysAgo: 2,
      })
      await seedMetricReading(pool, {
        metricKey: 'portal.feedback',
        value: 1,
        daysAgo: 4,
      })
      for (const daysAgo of [1, 3, 5]) {
        await seedMetricReading(pool, {
          metricKey: 'portal.feedback',
          value: 1,
          daysAgo,
        })
      }

      // Prior period (7–14 days ago)
      await seedReview(pool, { rating: 4, daysAgo: 10 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 8 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 12 })
      await seedMetricReading(pool, {
        metricKey: 'portal.feedback',
        value: 1,
        daysAgo: 9,
      })
      for (const daysAgo of [8, 10, 11, 12]) {
        await seedMetricReading(pool, {
          metricKey: 'portal.feedback',
          value: 1,
          daysAgo,
        })
      }

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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

      // Scans: 3 current, 2 prior → +50%
      expect(result.scans.value).toBe(3)
      expect(result.scans.priorValue).toBe(2)
      expect(result.scans.trend).toBe(50)

      // Feedback: both periods meet the immutable five-response minimum.
      expect(result.feedback.value).toBe(5)
      expect(result.feedback.priorValue).toBe(5)
      expect(result.feedback.trend).toBe(0)
    })

    it('does not turn a missing prior Metric period into a zero comparison', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Only current period data
      await seedReview(pool, { rating: 5, daysAgo: 1 })
      await seedMetricReading(pool, { metricKey: 'portal.scan', value: 1, daysAgo: 1 })
      await seedMetricReading(pool, {
        metricKey: 'portal.feedback',
        value: 1,
        daysAgo: 1,
      })

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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

      expect(result.scans.value).toBe(1)
      expect(result.scans.priorValue).toBeNull()
      expect(result.scans.trend).toBeNull()
      expect(result.scans.evidence.prior?.state).toBe('updating')
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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

  describe('getEngagementFunnel', () => {
    it('withholds the funnel while any governed metric family is not available', async () => {
      const repo = createDashboardRepository({} as ReviewStatsPort, {
        getSumsByPeriod: vi.fn(),
        getSumsByPortal: vi.fn(),
        getSumsByPortals: vi.fn(),
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
            state: 'updating',
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
      })

      const result = await repo.getEngagementFunnel({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-09-01T00:00:00.000Z'),
      })

      expect(result).toBeNull()
    })

    it('returns scans, ratings, and review link clicks for a portal', async () => {
      const pool = getPool()
      await seedProperty(pool, PROP_A, ORG_A)

      // Seed portal
      await pool.query(
        `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug)
         VALUES ($1, $2, $3, 'property', $4, 'Test Portal', 'test-portal')
         ON CONFLICT (id) DO NOTHING`,
        [PORTAL_A, ORG_A, PROP_A, PROP_A],
      )

      // Seed metric readings for the portal
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.scan',
        value: 1,
        daysAgo: 1,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.scan',
        value: 1,
        daysAgo: 2,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.scan',
        value: 1,
        daysAgo: 3,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.rating',
        value: 1,
        daysAgo: 1,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.rating',
        value: 1,
        daysAgo: 2,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.rating',
        value: 1,
        daysAgo: 3,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.rating',
        value: 1,
        daysAgo: 4,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.rating',
        value: 1,
        daysAgo: 5,
      })
      await seedMetricReading(pool, {
        portalId: PORTAL_A,
        metricKey: 'portal.review_link_click',
        value: 1,
        daysAgo: 1,
      })

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
      const result = await repo.getEngagementFunnel({
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        startDate: new Date(Date.now() - 7 * MS_PER_DAY),
        endDate: new Date(),
      })

      expect(result).not.toBeNull()
      expect(result?.scans).toBe(3)
      expect(result?.ratings).toBe(5) // portal.rating
      expect(result?.reviewLinkClicks).toBe(1)
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
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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

      await seedMetricReading(pool, {
        orgId: ORG_A,
        propId: PROP_A,
        metricKey: 'portal.scan',
        value: 1,
        daysAgo: 1,
      })
      await seedMetricReading(pool, {
        orgId: ORG_B,
        propId: PROP_B,
        metricKey: 'portal.scan',
        value: 1,
        daysAgo: 1,
      })

      const db = getDb()
      const repo = createDashboardRepository(
        createReviewStats(db),
        createMetricStatsAdapter(db),
      )
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

      // Only 1 scan from ORG_A
      expect(result.scans.value).toBe(1)
    })
  })
})
