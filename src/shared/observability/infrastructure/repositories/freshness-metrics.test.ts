// Freshness/delivery gauges against the REAL reads (real PostgreSQL).
//
// The unit suite fakes the select-chain, so it proves the mapping but not the
// SQL. These two aggregates are the whole point of the alerts that sit on
// them, and both express a semantic the DB has to get right:
//
//   sync.oldestDueAgeMs — MIN over PAST-DUE next_incremental_at only, so a
//     property parked in the future can never inflate it.
//   notifications.* — "overdue" is COALESCE(next_attempt_at, not_before,
//     created_at) in the past, only for status='pending'; attemptedStuckCount
//     is the subset the delivery path already touched.
//
// Determinism: the scratch database is shared, so every assertion is a DELTA
// over a pre-seed baseline (counts) or a lower bound (MIN ages — a leftover
// older row can only make the age larger, never smaller). Seeded rows carry
// suite-unique markers and are deleted after each test; the integration
// project runs serially (maxWorkers: 1).

import { describe, it, expect, afterEach } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createHealthChecker } from '#/shared/observability/health-metrics'

const MARKER_ORG = 'org-obs-freshness'
const MARKER_SYNC_PROP = 'prop-obs-freshness'
const MARKER_PROP_UUID = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e60'

const db = getDb()
const checker = createHealthChecker(db)

const MINUTE_MS = 60_000

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM review_sync_state WHERE property_id LIKE ${`${MARKER_SYNC_PROP}%`}`,
  )
  await db.execute(
    sql`DELETE FROM notification_email_queue WHERE organization_id = ${MARKER_ORG}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${MARKER_ORG}`)
})

async function seedSyncState(suffix: string, dueMinutesAgo: number | null) {
  const nextIncremental =
    dueMinutesAgo == null
      ? sql`NOW() + INTERVAL '1 day'`
      : sql`NOW() - (${dueMinutesAgo} * INTERVAL '1 minute')`
  await db.execute(sql`
    INSERT INTO review_sync_state (property_id, source, next_incremental_at, updated_at)
    VALUES (${`${MARKER_SYNC_PROP}-${suffix}`}, 'google', ${nextIncremental}, NOW())
  `)
}

describe('sync freshness aggregate (real reads)', () => {
  it('reports the oldest PAST-DUE age and ignores properties parked in the future', async () => {
    const baseline = (await checker.check()).sync

    // A property parked a day out must not register as overdue at all.
    await seedSyncState('future', null)
    const parked = (await checker.check()).sync
    expect(parked.dueForIncrementalCount).toBe(baseline.dueForIncrementalCount)

    await seedSyncState('lagging', 90)
    const lagging = (await checker.check()).sync
    expect(lagging.dueForIncrementalCount).toBe(baseline.dueForIncrementalCount + 1)
    expect(lagging.oldestDueAgeMs).not.toBeNull()
    expect(lagging.oldestDueAgeMs!).toBeGreaterThanOrEqual(89 * MINUTE_MS)

    // MIN semantics: an older overdue row moves the gauge up, a newer one
    // does not move it down.
    await seedSyncState('ancient', 300)
    await seedSyncState('recent', 2)
    const worst = (await checker.check()).sync
    expect(worst.dueForIncrementalCount).toBe(baseline.dueForIncrementalCount + 3)
    expect(worst.oldestDueAgeMs!).toBeGreaterThanOrEqual(299 * MINUTE_MS)
  })
})

async function seedProperty() {
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${MARKER_PROP_UUID}, ${MARKER_ORG}, 'Freshness Metrics Property', 'obs-freshness', 'UTC', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
}

type EmailSeed = Readonly<{
  key: string
  status: string
  /** SQL fragment for next_attempt_at (NULL column when omitted). */
  nextAttempt?: SQL
  /** SQL fragment for not_before (NULL column when omitted). */
  notBefore?: SQL
  attempted?: boolean
}>

async function seedEmail(seed: EmailSeed) {
  await db.execute(sql`
    INSERT INTO notification_email_queue (
      notification_id, user_id, organization_id, property_id,
      category, cadence, status, priority, idempotency_key,
      not_before, next_attempt_at, attempted_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${MARKER_PROP_UUID},
      'review', 'daily', ${seed.status}, 'normal', ${seed.key},
      ${seed.notBefore ?? sql`NULL`}, ${seed.nextAttempt ?? sql`NULL`},
      ${seed.attempted === true ? sql`NOW() - INTERVAL '25 minutes'` : sql`NULL`},
      NOW(), NOW()
    )
  `)
}

describe('notification email delivery aggregate (real reads)', () => {
  it('counts only overdue pending rows and isolates the already-attempted subset', async () => {
    const baseline = (await checker.check()).notifications
    await seedProperty()

    // Overdue by 3h on next_attempt_at, never attempted.
    await seedEmail({
      key: 'obs-freshness-overdue-unattempted',
      status: 'pending',
      nextAttempt: sql`NOW() - INTERVAL '3 hours'`,
    })
    // Overdue by 30min on not_before, and the delivery path already tried it.
    await seedEmail({
      key: 'obs-freshness-overdue-attempted',
      status: 'pending',
      notBefore: sql`NOW() - INTERVAL '30 minutes'`,
      attempted: true,
    })
    // Held for a future cadence slot — pending but NOT overdue.
    await seedEmail({
      key: 'obs-freshness-not-yet-due',
      status: 'pending',
      notBefore: sql`NOW() + INTERVAL '1 hour'`,
    })
    // Already sent long ago — must never count, whatever its timestamps say.
    await seedEmail({
      key: 'obs-freshness-sent',
      status: 'sent',
      nextAttempt: sql`NOW() - INTERVAL '5 hours'`,
    })

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount + 2)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount + 1)
    expect(after.oldestPendingOverdueAgeMs).not.toBeNull()
    expect(after.oldestPendingOverdueAgeMs!).toBeGreaterThanOrEqual(179 * MINUTE_MS)
  })

  it('falls back to created_at when a pending row has no schedule at all', async () => {
    const baseline = (await checker.check()).notifications
    await seedProperty()

    // No not_before, no next_attempt_at: the row is due the moment it exists,
    // so created_at is what "overdue" has to be measured from.
    await db.execute(sql`
      INSERT INTO notification_email_queue (
        notification_id, user_id, organization_id, property_id,
        category, cadence, status, priority, idempotency_key,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${MARKER_PROP_UUID},
        'review', 'urgent', 'pending', 'high', 'obs-freshness-unscheduled',
        NOW() - INTERVAL '4 hours', NOW()
      )
    `)

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount + 1)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount)
    expect(after.oldestPendingOverdueAgeMs!).toBeGreaterThanOrEqual(239 * MINUTE_MS)
  })
})
