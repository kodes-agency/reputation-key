// What notification.email-stalled may call overdue (real PostgreSQL).
//
// Two ways the overdue set was wrong once email is live for every
// Organization (BETA_ALLOWLIST_ORGS=*), where the alert judges it:
//
//   - An unscheduled daily-digest row was due at created_at, so it read as
//     overdue two hours later — but it goes out in the recipient's next 08:00
//     window, up to a day away. The alert would have paged every day.
//   - Rows in a scope that may not send (a suspended Organization, a killed
//     capability) counted, though nothing ever processes them there.
//
// Shared scratch database: the cadence case is a DELTA over a baseline; the
// scope case restricts the checker to this suite's Organization.

import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createHealthChecker } from '#/shared/observability/health-metrics'

const MARKER_ORG = 'org-obs-overdue-scope'
const PROP = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e70'
const DENIED_PROP = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e71'
const MINUTE_MS = 60_000

const db = getDb()

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM notification_email_queue WHERE organization_id = ${MARKER_ORG}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${MARKER_ORG}`)
})

async function seedProperty(id: string, slug: string) {
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${id}, ${MARKER_ORG}, 'Overdue Scope Property', ${slug}, 'UTC', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
}

/** A queued row nothing has scheduled or touched yet. */
async function seedUnscheduled(
  key: string,
  cadence: 'immediate' | 'daily',
  hoursOld: number,
  propertyId = PROP,
) {
  await db.execute(sql`
    INSERT INTO notification_email_queue (
      notification_id, user_id, organization_id, property_id,
      category, cadence, status, priority, idempotency_key,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'user-obs-overdue', ${MARKER_ORG}, ${propertyId},
      'review', ${cadence}, 'pending', 'normal', ${key},
      NOW() - (${hoursOld} * INTERVAL '1 hour'), NOW()
    )
  `)
}

describe('notification email overdue set (real reads)', () => {
  it('waits for the next digest window before calling a daily row overdue', async () => {
    const checker = createHealthChecker(db)
    const baseline = (await checker.check()).notifications
    await seedProperty(PROP, 'obs-overdue-scope')

    // Queued this morning after the window closed: goes out tomorrow at 08:00.
    await seedUnscheduled('obs-overdue-daily-fresh', 'daily', 3)
    // Missed a whole day's window: late.
    await seedUnscheduled('obs-overdue-daily-late', 'daily', 28)

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount + 1)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount)
  })

  it('counts overdue rows only where email may send now', async () => {
    await seedProperty(PROP, 'obs-overdue-scope')
    await seedProperty(DENIED_PROP, 'obs-overdue-scope-denied')
    const scoped = createHealthChecker(db, undefined, {
      emailDeliveryEnabled: true,
      // A suspended Organization, or a Property outside the decision.
      isEmailDeliveryAllowed: (scope) =>
        scope.organizationId === MARKER_ORG && scope.propertyId !== DENIED_PROP,
    })

    await seedUnscheduled('obs-overdue-allowed', 'immediate', 4)
    await seedUnscheduled('obs-overdue-denied', 'immediate', 6, DENIED_PROP)

    const after = (await scoped.check()).notifications

    expect(after.pendingOverdueCount).toBe(1)
    expect(after.oldestPendingOverdueAgeMs!).toBeGreaterThanOrEqual(239 * MINUTE_MS)
    expect(after.oldestPendingOverdueAgeMs!).toBeLessThan(241 * MINUTE_MS)
  })
})
