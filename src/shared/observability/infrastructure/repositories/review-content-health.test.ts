// Review content health against the REAL read (real PostgreSQL).
//
// `health.reviews` counts the Reviews that carry a content clock, how many are
// inside the refresh window and how many have passed it, and the P1 alert
// `source.freshness-deadline` fires when a refresh-due Review is within two
// days of its hard expiry. A Review Google deleted is erased but, before the
// erase cleared the clock, kept it: it would be counted as refresh-due, and as
// expired once the clock passed, although nothing can refresh it. The alert
// would page for a review that no longer exists. The gauge counts live
// Reviews only.
//
// The scratch database is shared, so every assertion is a DELTA over a
// pre-seed baseline; the integration project runs serially.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  insertLegacyTombstone,
  insertLiveReview,
} from '#/shared/testing/review-tombstone-fixtures'

const ORG = 'org-obs-review-content-health'
const PROPERTY = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e70'
const LIVE_DUE = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e71'
const TOMBSTONE_DUE = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e72'
const TOMBSTONE_PAST = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e73'

const DAY_MS = 24 * 60 * 60 * 1000
const checker = createHealthChecker(getDb())
const pool = getPool()

async function clean(): Promise<void> {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

beforeEach(async () => {
  await clean()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Review content health', $1, NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Review content health property', 'obs-review-content-health', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
})

afterEach(clean)

describe('health.reviews (real read)', () => {
  it('counts a live Review in the refresh window and not the erased ones beside it', async () => {
    const baseline = await checker.signals.reviews()
    const now = Date.now()
    const fetchedDaysAgo = (days: number) => new Date(now - days * DAY_MS)
    const scope = { organizationId: ORG, propertyId: PROPERTY } as const

    // Fetched 26 days ago: 4 days left on the clock, past the 25-day refresh point.
    await insertLiveReview(pool, {
      ...scope,
      id: LIVE_DUE,
      externalId: 'review-content-health-live',
      lastFetchedAt: fetchedDaysAgo(26),
      contentExpiresAt: new Date(now + 4 * DAY_MS),
    })
    // Erased after being fetched 29 days ago: it kept a clock one day from
    // expiry, the very shape that would trip the two-day freshness alert.
    await insertLegacyTombstone(pool, {
      ...scope,
      id: TOMBSTONE_DUE,
      lastFetchedAt: fetchedDaysAgo(29),
      contentExpiresAt: new Date(now + DAY_MS),
    })
    // Erased long ago: its kept clock has passed, so it would count as expired.
    await insertLegacyTombstone(pool, {
      ...scope,
      id: TOMBSTONE_PAST,
      state: 'source_expired',
      lastFetchedAt: fetchedDaysAgo(40),
      contentExpiresAt: new Date(now - 10 * DAY_MS),
    })

    const seeded = await checker.signals.reviews()

    expect(seeded.totalActive - baseline.totalActive).toBe(1)
    expect(seeded.refreshDueCount - baseline.refreshDueCount).toBe(1)
    expect(seeded.expiredCount - baseline.expiredCount).toBe(0)
  })
})
