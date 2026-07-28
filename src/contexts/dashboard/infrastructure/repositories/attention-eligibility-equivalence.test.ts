// BQC-5.5 — eligibility equivalence: the dashboard read facade's attention-
// signals predicate (its own copy — review's application public-api cannot
// export SQL fragments) must select exactly the rows the review-owned
// governed read interface selects, over a shared fixture set.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { reviews } from '#/shared/db/schema'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createEligibleReads } from '#/contexts/review/application/eligible-reads'
import { eligibleAttentionReviewWhere } from '../read-facade'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG = organizationId('org-attn-equiv-test-aaaa-1111111111')
const PROP = propertyId('2b000000-0000-0000-0000-0000000000f1')
const OTHER_ORG = organizationId('org-attn-equiv-test-bbbb-2222222222')
const OTHER_PROP = propertyId('2b000000-0000-0000-0000-0000000000f2')
const IDS = {
  eligible: '2b000000-0000-0000-0000-0000000000c1',
  expired: '2b000000-0000-0000-0000-0000000000c2',
  clockLess: '2b000000-0000-0000-0000-0000000000c3',
  otherOrg: '2b000000-0000-0000-0000-0000000000c4',
} as const

const DAY_MS = 24 * 60 * 60 * 1000

let pool: Pool
const db = getDb()

async function insertReview(
  id: string,
  org: string,
  prop: string,
  contentExpiresAt: Date | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, reviewer_name, rating, text, reviewed_at,
      expires_at, content_expires_at, first_fetched_at, last_fetched_at
    ) VALUES (
      ${id}, ${org}, ${prop}, 'google', ${'ext-' + id.slice(-2)},
      'accounts/1/locations/2', 'Jane', 5, 'Great stay', now(),
      now(), ${contentExpiresAt}, now(), now()
    )
  `)
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  for (const [org, slug] of [
    [ORG, 'attn-equiv-org'],
    [OTHER_ORG, 'attn-equiv-org-2'],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org, 'Attn Equiv Org', slug],
    )
  }
  for (const [prop, org, slug] of [
    [PROP, ORG, 'attn-equiv-prop'],
    [OTHER_PROP, OTHER_ORG, 'attn-equiv-prop-2'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      [prop, org, 'Attn Equiv Prop', slug],
    )
  }
})

afterAll(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id IN ($1, $2)', [
    ORG,
    OTHER_ORG,
  ])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id IN ($1, $2)', [
    ORG,
    OTHER_ORG,
  ])
})

describe('attention-signals eligibility ⇔ review governed rule (BQC-5.5)', () => {
  it('both predicates select the same rows over the shared fixture set', async () => {
    await insertReview(IDS.eligible, ORG, PROP, new Date(Date.now() + 10 * DAY_MS))
    await insertReview(IDS.expired, ORG, PROP, new Date(Date.now() - 60 * 60 * 1000))
    await insertReview(IDS.clockLess, ORG, PROP, null)
    // Decoy: eligible but another org — excluded by both predicates' scope.
    await insertReview(
      IDS.otherOrg,
      OTHER_ORG,
      OTHER_PROP,
      new Date(Date.now() + 10 * DAY_MS),
    )

    const now = new Date()

    // Review-owned governed rule (the authority).
    const reviewRule = createEligibleReads({
      reviewRepo: createReviewRepository(db),
      clock: () => now,
    })
    const reviewIds = await reviewRule.findEligibleReviewIds(ORG, {})

    // Dashboard facade copy.
    const rows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eligibleAttentionReviewWhere(ORG, PROP, now))
    const dashboardIds = rows.map((r) => r.id)

    expect(dashboardIds.sort()).toEqual([...reviewIds].sort())
    expect(dashboardIds).toEqual([IDS.eligible])
  })
})
