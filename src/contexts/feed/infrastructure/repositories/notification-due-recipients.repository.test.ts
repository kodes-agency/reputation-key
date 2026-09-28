// Which recipients the hourly digest sweep visits first (real PostgreSQL).
//
// The sweep reads at most a capped number of recipients per tick. Daily rows
// wait up to a day for the recipient's local 08:00, so recipients in every
// timezone are due at every tick; ordered by id alone, the same first ones
// were read every hour, mostly outside their window, and those past the cap
// were never visited until their rows went stale. The order now puts work that
// is due at any hour first (a quiet-hours release, a retry), then recipients
// whose 08:00 is now, resolved the way the job resolves their timezone.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createNotificationEmailRepository } from './notification-email.repository'

const ORG = 'org-notification-due-recipients'
const PROPERTY = '88000000-0000-4000-8000-000000000001'
// 08:30 UTC: 04:30 in New York (the Organization's zone), 08:30 in UTC.
const NOW = new Date('2026-09-25T08:30:00.000Z')

// Named so that id order is the reverse of the order they must be visited in.
const ON_ORGANIZATION_ZONE = 'due-recipient-a'
const INVALID_ZONE = 'due-recipient-b'
const IN_WINDOW = 'due-recipient-c'
const RELEASED_FROM_QUIET_HOURS = 'due-recipient-d'

let pool: Pool
let sequence = 0

async function queueRow(user: string, status: 'pending' | 'delayed') {
  sequence += 1
  const suffix = String(sequence).padStart(3, '0')
  const notification = `88000000-0000-4000-8000-000000001${suffix}`
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'goal.completed', 'recognition', 'normal', 'unread',
       'goal', $5, $5, 'Goal', $6, $6)`,
    [notification, user, ORG, PROPERTY, `due-recipients-${suffix}`, NOW],
  )
  await pool.query(
    `INSERT INTO notification_email_queue (
       id, notification_id, user_id, organization_id, property_id, category, cadence,
       status, priority, idempotency_key, not_before, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'recognition', 'daily', $6, 'normal', $7, $8, $9, $9)`,
    [
      `88000000-0000-4000-9000-000000002${suffix}`,
      notification,
      user,
      ORG,
      PROPERTY,
      status,
      `due-recipients-${suffix}`,
      status === 'delayed' ? new Date(NOW.getTime() - 60_000) : null,
      NOW,
    ],
  )
}

async function userTimezone(user: string, timezone: string) {
  await pool.query(
    `INSERT INTO notification_user_settings (user_id, organization_id, timezone)
     VALUES ($1, $2, $3)`,
    [user, ORG, timezone],
  )
}

async function removeFixtures() {
  await pool.query('DELETE FROM notification_email_queue WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM notification_user_settings WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await removeFixtures()
  await pool.end()
})

beforeEach(async () => {
  await removeFixtures()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Due recipients', 'notification-due-recipients', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbor Inn', 'notification-due-recipients', 'America/New_York', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  await queueRow(ON_ORGANIZATION_ZONE, 'pending')
  await queueRow(INVALID_ZONE, 'pending')
  await userTimezone(INVALID_ZONE, 'Mars/Olympus_Mons')
  await queueRow(IN_WINDOW, 'pending')
  await userTimezone(IN_WINDOW, 'UTC')
  await queueRow(RELEASED_FROM_QUIET_HOURS, 'delayed')
  await userTimezone(RELEASED_FROM_QUIET_HOURS, 'Asia/Tokyo')
})

describe.sequential('the digest sweep visit order (real PostgreSQL)', () => {
  it('visits work due at any hour, then recipients whose 08:00 is now', async () => {
    const recipients = await createNotificationEmailRepository(getDb()).findDueRecipients(
      'daily',
      NOW,
    )

    const ours = recipients
      .filter((recipient) => (recipient.organizationId as string) === ORG)
      .map((recipient) => recipient.userId as string)
    expect(ours.slice(0, 2)).toEqual([RELEASED_FROM_QUIET_HOURS, IN_WINDOW])
    expect([...ours.slice(2)].sort()).toEqual([ON_ORGANIZATION_ZONE, INVALID_ZONE])
  })
})
