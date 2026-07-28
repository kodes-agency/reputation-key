// BQC-5.5 — ReviewServingStats is a family of serving reads: EVERY
// review-content read (aggregates included) excludes expired and clock-less
// content in SQL (ADR 0031). Eligibility compares against the injected clock,
// never DB now() (BQC-5.3).
//
// Moved from dashboard/infrastructure/repositories/review-stats-eligibility
// .test.ts (getRecentReviews case) and extended to the aggregate reads that
// previously read review content without the eligibility predicate.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { createServingStats } from '../serving-stats'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG = organizationId('org-serving-stats-elig-aa-1111111111')
const PROP = propertyId('2b000000-0000-0000-0000-0000000000e1')
const REVIEW_IDS = {
  eligible: '2b000000-0000-0000-0000-0000000000b1',
  expired: '2b000000-0000-0000-0000-0000000000b2',
  clockLess: '2b000000-0000-0000-0000-0000000000b3',
} as const

const DAY_MS = 24 * 60 * 60 * 1000

let pool: Pool
const db = getDb()

// Eligibility compares against the injected clock (real time here), never DB
// now() — the fixture offsets (±hours/days) make skew a non-issue.
const createStats = (database: Database) =>
  createServingStats({ db: database, clock: () => new Date() })

async function insertReview(
  id: string,
  contentExpiresAt: Date | null,
  rating = 5,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, reviewer_name, rating, text, reviewed_at,
      expires_at, content_expires_at, first_fetched_at, last_fetched_at
    ) VALUES (
      ${id}, ${ORG}, ${PROP}, 'google', ${'ext-' + id.slice(-2)},
      'accounts/1/locations/2', 'Jane', ${rating}, 'Great stay', now(),
      now(), ${contentExpiresAt}, now(), now()
    )
  `)
}

/** Seed the three-state fixture: one servable, one expired, one clock-less. */
async function insertEligibilityFixture(ratings?: { eligible?: number }): Promise<void> {
  await insertReview(
    REVIEW_IDS.eligible,
    new Date(Date.now() + 10 * DAY_MS),
    ratings?.eligible ?? 5,
  )
  await insertReview(REVIEW_IDS.expired, new Date(Date.now() - 60 * 60 * 1000), 1)
  await insertReview(REVIEW_IDS.clockLess, null, 1)
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING`,
    [ORG, 'Serving Stats Elig Org', 'serving-stats-elig-org'],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [PROP, ORG, 'Serving Stats Elig Prop', 'serving-stats-elig-prop'],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
})

describe('ReviewServingStats eligibility (BQC-5.5 / ADR 0031)', () => {
  it('getRecentReviews serves only eligible content: expired and clock-less rows are excluded', async () => {
    await insertEligibilityFixture()

    const stats = createStats(db)
    const rows = await stats.getRecentReviews(ORG, PROP, 10)

    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Great stay')
  })

  it('getPeriodStats excludes expired and clock-less content from count and average', async () => {
    await insertEligibilityFixture({ eligible: 4 })

    const stats = createStats(db)
    const result = await stats.getPeriodStats(
      ORG,
      PROP,
      new Date(Date.now() - DAY_MS),
      new Date(Date.now() + DAY_MS),
    )

    expect(result.count).toBe(1)
    expect(result.avgRating).toBe(4)
  })

  it('getRatingDistribution excludes expired and clock-less content from star buckets', async () => {
    await insertEligibilityFixture()

    const stats = createStats(db)
    const rows = await stats.getRatingDistribution(
      ORG,
      PROP,
      new Date(Date.now() - DAY_MS),
      new Date(Date.now() + DAY_MS),
    )

    expect(rows.find((b) => b.stars === 5)?.count).toBe(1)
    expect(rows.find((b) => b.stars === 1)?.count).toBe(0)
  })

  it('getReplyPerformance treats a reply of an expired review as not servable', async () => {
    await insertEligibilityFixture()
    // Published reply attached to the EXPIRED review — it must not count.
    await db.execute(sql`
      INSERT INTO replies (id, review_id, organization_id, text, status, source, published_at)
      VALUES (
        ${crypto.randomUUID()}, ${REVIEW_IDS.expired}, ${ORG},
        'Thanks', 'published', 'internal', now()
      )
    `)

    const stats = createStats(db)
    const result = await stats.getReplyPerformance(
      ORG,
      PROP,
      new Date(Date.now() - DAY_MS),
      new Date(Date.now() + DAY_MS),
    )

    expect(result.totalReviews).toBe(1)
    expect(result.repliedCount).toBe(0)
    expect(result.avgReplyHours).toBeNull()
  })
})
