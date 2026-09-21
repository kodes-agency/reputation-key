// The in-app feed and its unread badge follow CURRENT Property access (real
// PostgreSQL).
//
// Notifications are addressed when they are delivered, but access can end
// afterwards: a revoked grant or an expired temporary grant leaves rows about
// a Property the reader may no longer see. The feed head, its keyset pages and
// the unread count must all drop those rows, while Organization-scoped notices
// (no Property: mandatory account notices, beta report outcomes) stay visible.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createNotificationRepository } from './notification.repository'

const ORG = 'org-notification-property-access'
const USER = 'user-notification-property-access'
const RIVERSIDE = '86200000-0000-4000-8000-000000000001'
const HARBOR = '86200000-0000-4000-8000-000000000002'

const RIVERSIDE_ROW = '86200000-0000-4000-8000-000000000011'
const HARBOR_ROW = '86200000-0000-4000-8000-000000000012'
const ACCOUNT_NOTICE = '86200000-0000-4000-8000-000000000013'

let pool: Pool

async function insertPropertyNotification(
  id: string,
  propertyId: string,
  minute: number,
) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 'feedback.created', 'urgent_operational', 'normal', 'unread',
       'inbox_item', $5, $6, 'Test', $7, $7
     )`,
    [
      id,
      USER,
      ORG,
      propertyId,
      `resource-${id}`,
      `event-${id}`,
      `2026-08-25T10:0${minute}:00Z`,
    ],
  )
}

async function insertAccountNotice() {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES (
       $1, $2, $3, NULL, 'account.organization_role_changed', 'mandatory', 'normal', 'unread',
       'organization', $3, $4, 'Test', '2026-08-25T10:00:00Z', '2026-08-25T10:00:00Z'
     )`,
    [ACCOUNT_NOTICE, USER, ORG, `event-${ACCOUNT_NOTICE}`],
  )
}

async function removeFixtures() {
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [RIVERSIDE, HARBOR])
  await deleteTestOrganizations(pool, [ORG])
}

const feedQuery = (visiblePropertyIds: readonly string[] | null) =>
  ({
    userId: USER,
    organizationId: ORG,
    visiblePropertyIds,
    limit: 10,
    filter: 'all',
  }) as const

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
     VALUES ($1, 'Property access', 'notification-property-access', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Riverside Hotel', 'notification-access-riverside', 'UTC', NOW(), NOW()),
            ($2, $3, 'Harbor Inn', 'notification-access-harbor', 'UTC', NOW(), NOW())`,
    [RIVERSIDE, HARBOR, ORG],
  )
  await insertPropertyNotification(RIVERSIDE_ROW, RIVERSIDE, 2)
  await insertPropertyNotification(HARBOR_ROW, HARBOR, 1)
  await insertAccountNotice()
})

describe.sequential('notification feed Property access (real PostgreSQL)', () => {
  it('drops a Property the reader lost from the head and the unread badge', async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead(
      feedQuery([HARBOR]),
    )

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      HARBOR_ROW,
      ACCOUNT_NOTICE,
    ])
    expect(head.unreadCount).toBe(2)
  })

  it('drops it from keyset pages below the head too', async () => {
    const page = await createNotificationRepository(getDb()).readFeedPage({
      ...feedQuery([HARBOR]),
      before: null,
    })

    expect(page.notifications.map((row) => row.id)).toEqual([HARBOR_ROW, ACCOUNT_NOTICE])
  })

  it('keeps Organization notices for a reader with no Property access left', async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead(feedQuery([]))

    expect(head.page.notifications.map((row) => row.id)).toEqual([ACCOUNT_NOTICE])
    expect(head.unreadCount).toBe(1)
  })

  it('shows every Property to an Organization-wide reader', async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead(feedQuery(null))

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      RIVERSIDE_ROW,
      HARBOR_ROW,
      ACCOUNT_NOTICE,
    ])
    expect(head.unreadCount).toBe(3)
  })
})
