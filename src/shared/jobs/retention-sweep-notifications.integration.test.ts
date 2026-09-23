// Notification retention against real PostgreSQL. A notice lives ninety days
// from its latest ARRIVAL, not its creation: an alert re-raised for months
// coalesces into one unread row, and deleting that row by `created_at` made a
// live alert vanish and the badge drop. Reading a notice never extends it. And
// no queued email or digest row may outlive the notification it would send.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { RETENTION_RULES } from './retention-sweep.job'

const ORG = `notification-retention-${randomUUID().slice(0, 8)}`
const PROPERTY = randomUUID()
const USER = 'notification-retention-user'
const NOW = new Date('2026-09-22T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

let lease: TestLease
let db: Database

type Seeded = Readonly<{
  createdDaysAgo: number
  refiredDaysAgo?: number
  readDaysAgo?: number
  emailStatus?: string
}>

async function seedNotification(seed: Seeded): Promise<string> {
  const id = randomUUID()
  const read = seed.readDaysAgo !== undefined
  await db.execute(sql`
    INSERT INTO notifications (
      id, user_id, organization_id, property_id, type, category, status,
      resource_type, resource_id, event_id, title, payload,
      coalesced_count, coalesced_latest_at, read_at, created_at, updated_at
    ) VALUES (
      ${id}, ${USER}, ${ORG}, ${PROPERTY}, 'review.created', 'workflow_collaboration',
      ${read ? 'read' : 'unread'}, 'inbox_item', ${`item-${id}`}, ${`event-${id}`},
      'New review', '{}'::jsonb,
      ${seed.refiredDaysAgo === undefined ? 1 : 7},
      ${seed.refiredDaysAgo === undefined ? null : daysAgo(seed.refiredDaysAgo)},
      ${read ? daysAgo(seed.readDaysAgo as number) : null},
      ${daysAgo(seed.createdDaysAgo)},
      ${daysAgo(Math.min(seed.createdDaysAgo, seed.refiredDaysAgo ?? Infinity, seed.readDaysAgo ?? Infinity))}
    )
  `)
  if (seed.emailStatus !== undefined) {
    await db.execute(sql`
      INSERT INTO notification_email_queue (
        id, notification_id, user_id, organization_id, property_id, category,
        cadence, status, idempotency_key, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${id}, ${USER}, ${ORG}, ${PROPERTY}, 'workflow_collaboration',
        'daily', ${seed.emailStatus}, ${`${id}:email`},
        ${daysAgo(seed.createdDaysAgo)}, ${daysAgo(seed.createdDaysAgo)}
      )
    `)
  }
  return id
}

/** The live notification and queue rules, confined to this suite's tenant. */
async function sweepNotifications(): Promise<void> {
  const rules = RETENTION_RULES.filter(
    (rule) => rule.table === 'notifications' || rule.table === 'notification_email_queue',
  )
  for (const rule of rules) {
    await executeRetentionRule(
      db,
      {
        ...rule,
        extraWhere: `(${rule.extraWhere ?? 'TRUE'}) AND organization_id = '${ORG}'`,
      },
      { cutoff: new Date(NOW.getTime() - rule.olderThanMs) },
    )
  }
}

const notificationIds = async (): Promise<readonly string[]> =>
  (
    await db.execute<{ id: string }>(
      sql`SELECT id FROM notifications WHERE organization_id = ${ORG}`,
    )
  ).rows.map((row) => row.id)

const queuedNotificationIds = async (): Promise<readonly string[]> =>
  (
    await db.execute<{ notification_id: string }>(
      sql`SELECT notification_id FROM notification_email_queue WHERE organization_id = ${ORG}`,
    )
  ).rows.map((row) => row.notification_id)

describe.sequential('notification retention (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
    await db.execute(
      sql`DELETE FROM notification_email_queue WHERE organization_id = ${ORG}`,
    )
    await db.execute(sql`DELETE FROM notifications WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone)
      VALUES (${PROPERTY}, ${ORG}, 'Retention Property', ${ORG}, 'UTC')
    `)
  })

  afterAll(async () => {
    if (db) {
      await db.execute(
        sql`DELETE FROM notification_email_queue WHERE organization_id = ${ORG}`,
      )
      await db.execute(sql`DELETE FROM notifications WHERE organization_id = ${ORG}`)
      await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
    }
    await lease?.release()
  })

  it('keeps an unread alert created 100 days ago that was re-raised yesterday', async () => {
    const live = await seedNotification({ createdDaysAgo: 100, refiredDaysAgo: 1 })
    const expired = await seedNotification({ createdDaysAgo: 100 })

    await sweepNotifications()

    expect(await notificationIds()).toEqual([live])
    expect(await notificationIds()).not.toContain(expired)
  })

  it('never lets reading a notice extend it', async () => {
    await seedNotification({ createdDaysAgo: 100, readDaysAgo: 1 })

    await sweepNotifications()

    expect(await notificationIds()).toEqual([])
  })

  it('removes the queued email and digest rows of a notification it deletes', async () => {
    // Nothing can send them: the digest and urgent paths read the notice.
    const expired = await seedNotification({
      createdDaysAgo: 100,
      emailStatus: 'pending',
    })
    const live = await seedNotification({
      createdDaysAgo: 100,
      refiredDaysAgo: 1,
      emailStatus: 'pending',
    })

    await sweepNotifications()

    expect(await notificationIds()).toEqual([live])
    expect(await queuedNotificationIds()).toEqual([live])
    expect(await queuedNotificationIds()).not.toContain(expired)
  })
})
