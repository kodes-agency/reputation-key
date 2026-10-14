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
// The same goes for a live Review whose Property the refresh sweep no longer
// serves (archived, suspended, deleted, disconnected from Google, or on a
// connection that needs reauthorisation): the sweep does not offer it, so no
// refresh is coming, and the alert would page on day 28 for content nobody
// can refresh. Refresh-due counts only what the sweep can offer; the totals
// and the expired count still cover every live Review, because content held
// past its deadline is a fact whoever could have refreshed it.
//
// The scratch database is shared, so every assertion is a DELTA over a
// pre-seed baseline; the integration project runs serially.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import {
  insertLegacyTombstone,
  insertLiveReview,
} from '#/shared/testing/review-tombstone-fixtures'

// Provider resource literals may only come from the generated fixture catalogue.
const { accountId: GBP_ACCOUNT_ID, locationId: GBP_LOCATION_ID } =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments

const ORG = 'org-obs-review-content-health'
const PROPERTY = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e70'
const CONNECTION = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e7a'
const LIVE_DUE = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e71'
const TOMBSTONE_DUE = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e72'
const TOMBSTONE_PAST = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e73'
const LIVE_PAST = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e74'

const DAY_MS = 24 * 60 * 60 * 1000
const checker = createHealthChecker(getDb())
const pool = getPool()

async function clean(): Promise<void> {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG])
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
    `INSERT INTO google_connections
       (id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status, credential_use_state, created_at, updated_at)
     VALUES ($1, $2, 'subject-review-content-health', 'enc-a', 'enc-r',
             NOW() + INTERVAL '1 day',
             ARRAY['https://www.googleapis.com/auth/business.manage'],
             'seed-user', 'organization', 'active', 'active', NOW(), NOW())`,
    [CONNECTION, ORG],
  )
  // A Property the refresh sweep serves: live, bound to Google, usable connection.
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, google_connection_id,
        gbp_account_id, gbp_location_id, google_binding_state, created_at, updated_at)
     VALUES ($1, $2, 'Review content health property', 'obs-review-content-health',
             'UTC', $3, $4, $5, 'active', NOW(), NOW())`,
    [PROPERTY, ORG, CONNECTION, GBP_ACCOUNT_ID, GBP_LOCATION_ID],
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
      googleConnectionId: CONNECTION,
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

  // Each of these leaves the refresh sweep's reach without touching a Review
  // row, so the Review keeps the clocks it had and the fetch that would renew
  // them never comes.
  it.each([
    [
      'archived',
      `UPDATE properties SET lifecycle_state = 'archived' WHERE id = '${PROPERTY}'`,
    ],
    [
      'suspended',
      `UPDATE properties SET lifecycle_state = 'suspended' WHERE id = '${PROPERTY}'`,
    ],
    ['deleted', `UPDATE properties SET deleted_at = NOW() WHERE id = '${PROPERTY}'`],
    [
      'disconnected from Google',
      `UPDATE properties SET google_binding_state = 'disconnected' WHERE id = '${PROPERTY}'`,
    ],
    [
      'on a connection that needs reauthorisation',
      `UPDATE google_connections SET status = 'reauth_required' WHERE id = '${CONNECTION}'`,
    ],
  ] satisfies ReadonlyArray<readonly [string, string]>)(
    'does not call a Review refresh-due when its Property is %s, and still counts it as held',
    async (_label, leaveTheSweep) => {
      const baseline = await checker.signals.reviews()
      const now = Date.now()
      const scope = { organizationId: ORG, propertyId: PROPERTY } as const

      // A day from its hard expiry: the shape that trips the two-day alert.
      await insertLiveReview(pool, {
        ...scope,
        id: LIVE_DUE,
        externalId: 'review-content-health-unserved-due',
        googleConnectionId: CONNECTION,
        lastFetchedAt: new Date(now - 29 * DAY_MS),
        contentExpiresAt: new Date(now + DAY_MS),
      })
      // Already past its clock: held past the deadline, withheld from reads.
      await insertLiveReview(pool, {
        ...scope,
        id: LIVE_PAST,
        externalId: 'review-content-health-unserved-past',
        googleConnectionId: CONNECTION,
        lastFetchedAt: new Date(now - 33 * DAY_MS),
        contentExpiresAt: new Date(now - 3 * DAY_MS),
      })
      await pool.query(leaveTheSweep)

      const seeded = await checker.signals.reviews()

      expect(seeded.refreshDueCount - baseline.refreshDueCount).toBe(0)
      expect(seeded.oldestDueAgeSeconds === null).toBe(
        baseline.oldestDueAgeSeconds === null,
      )
      expect(seeded.totalActive - baseline.totalActive).toBe(2)
      expect(seeded.expiredCount - baseline.expiredCount).toBe(1)
    },
  )
})
