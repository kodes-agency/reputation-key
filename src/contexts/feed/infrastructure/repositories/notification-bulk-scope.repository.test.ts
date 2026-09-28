// "Mark all read" and "Clear all" change only what the reader's feed shows
// (real PostgreSQL).
//
// The feed and its counts hide a Property the reader can no longer access and
// a category they switched off in-app, but both bulk actions used to reach
// every row of the reader: a notice about a Property whose grant had expired
// came back read, or gone, when access was renewed, never seen.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createNotificationRepository } from './notification.repository'

const ORG = 'org-notification-bulk-scope'
const USER = 'user-notification-bulk-scope'
const VISIBLE = '86500000-0000-4000-8000-000000000001'
const REVOKED = '86500000-0000-4000-8000-000000000002'

const SHOWN = '86500000-0000-4000-8000-000000000011'
const REVOKED_PROPERTY = '86500000-0000-4000-8000-000000000012'
const MUTED_IN_APP = '86500000-0000-4000-8000-000000000013'
const ACCOUNT_NOTICE = '86500000-0000-4000-8000-000000000014'

const AT = new Date('2026-09-28T09:00:00.000Z')
const SCOPE = {
  userId: userId(USER),
  organizationId: organizationId(ORG),
  visiblePropertyIds: [propertyId(VISIBLE)],
}

let pool: Pool

async function insertNotification(
  id: string,
  property: string | null,
  category: string,
  minute: number,
) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'normal', 'unread', $7, $8, $9, 'Test', $10, $10)`,
    [
      id,
      USER,
      ORG,
      property,
      property ? 'review.created' : 'account.organization_role_changed',
      category,
      property ? 'inbox_item' : 'organization',
      property ? `resource-${id}` : ORG,
      `event-${id}`,
      `2026-09-28T08:${String(minute).padStart(2, '0')}:00Z`,
    ],
  )
}

async function statuses(): Promise<Record<string, string>> {
  const result = await pool.query<{ id: string; status: string }>(
    'SELECT id, status FROM notifications WHERE organization_id = $1',
    [ORG],
  )
  return Object.fromEntries(result.rows.map((row) => [row.id, row.status]))
}

async function cleanUp() {
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM notification_preferences WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanUp()
  await pool.end()
})

beforeEach(async () => {
  await cleanUp()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Bulk scope', 'notification-bulk-scope', NOW())`,
    [ORG],
  )
  for (const [id, slug] of [
    [VISIBLE, 'visible'],
    [REVOKED, 'revoked'],
  ]) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())`,
      [id, ORG, slug, `notification-bulk-scope-${slug}`],
    )
  }
  await pool.query(
    `INSERT INTO notification_preferences (
       id, user_id, organization_id, property_id, category, channel, enabled, cadence,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'recognition', 'in_app', false, 'daily', NOW(), NOW())`,
    [randomUUID(), USER, ORG, VISIBLE],
  )
  await insertNotification(SHOWN, VISIBLE, 'workflow_collaboration', 4)
  await insertNotification(REVOKED_PROPERTY, REVOKED, 'workflow_collaboration', 3)
  await insertNotification(MUTED_IN_APP, VISIBLE, 'recognition', 2)
  await insertNotification(ACCOUNT_NOTICE, null, 'mandatory', 1)
})

describe.sequential('bulk actions follow what the feed shows (real PostgreSQL)', () => {
  it('"Mark all read" leaves hidden rows unread', async () => {
    await createNotificationRepository(getDb()).markAllRead(SCOPE, 'all', AT)

    expect(await statuses()).toEqual({
      [SHOWN]: 'read',
      [REVOKED_PROPERTY]: 'unread',
      [MUTED_IN_APP]: 'unread',
      [ACCOUNT_NOTICE]: 'read',
    })
  })

  it('"Clear all" leaves hidden rows in place', async () => {
    await createNotificationRepository(getDb()).markAllDismissed(SCOPE, AT)

    expect(await statuses()).toEqual({
      [SHOWN]: 'dismissed',
      [REVOKED_PROPERTY]: 'unread',
      [MUTED_IN_APP]: 'unread',
      [ACCOUNT_NOTICE]: 'dismissed',
    })
  })
})
