// BQC-1.4 — dashboard getRecentReviews is a serving read: it must exclude
// expired and clock-less review content in SQL (ADR 0031).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createReviewStatsAdapter } from '../adapters/review-stats.adapter'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG = organizationId('org-dash-elig-test-aaaa-1111111111')
const PROP = propertyId('2b000000-0000-0000-0000-0000000000d1')
const REVIEW_IDS = [
  '2b000000-0000-0000-0000-0000000000a1',
  '2b000000-0000-0000-0000-0000000000a2',
  '2b000000-0000-0000-0000-0000000000a3',
] as const

let pool: Pool
const db = getDb()

async function insertReview(id: string, contentExpiresAt: Date | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, reviewer_name, rating, text, reviewed_at,
      expires_at, content_expires_at, first_fetched_at, last_fetched_at
    ) VALUES (
      ${id}, ${ORG}, ${PROP}, 'google', ${'ext-' + id.slice(-2)},
      'accounts/1/locations/2', 'Jane', 5, 'Great stay', now(),
      now(), ${contentExpiresAt}, now(), now()
    )
  `)
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING`,
    [ORG, 'Dash Elig Org', 'dash-elig-org'],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [PROP, ORG, 'Dash Elig Prop', 'dash-elig-prop'],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
})

describe('dashboard getRecentReviews eligibility (BQC-1.4)', () => {
  it('serves only eligible content: expired and clock-less rows are excluded', async () => {
    await insertReview(REVIEW_IDS[0], new Date(Date.now() + 10 * 24 * 60 * 60 * 1000))
    await insertReview(REVIEW_IDS[1], new Date(Date.now() - 1000))
    await insertReview(REVIEW_IDS[2], null)

    const adapter = createReviewStatsAdapter(db)
    const rows = await adapter.getRecentReviews(ORG, PROP, 10)

    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Great stay')
  })
})
