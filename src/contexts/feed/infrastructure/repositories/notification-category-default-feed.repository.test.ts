// The bell and the notifications page honour "Apply to all my properties"
// (real PostgreSQL).
//
// Applying an in-app answer to every Property writes the person's category
// default and deletes the per-Property rows, so a Property's in-app choice can
// live in either table. Delivery already resolved Property row → category
// default → versioned default; the feed and its badge read only the
// per-Property table, so "in-app off everywhere" brought every muted row back
// and showed each new email-only anchor. These pin the read side to the same
// resolution.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, userId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createNotificationCategoryDefault } from '../../domain/constructors-preference'
import { createNotificationRepository } from './notification.repository'
import { createNotificationPreferenceRepository } from './notification-preference.repository'

const ORG = 'org-notification-category-default-feed'
const USER = 'user-notification-category-default-feed'
const RIVERSIDE = '86300000-0000-4000-8000-000000000001'
const HARBOR = '86300000-0000-4000-8000-000000000002'

const RIVERSIDE_UNREAD = '86300000-0000-4000-8000-000000000011'
const HARBOR_UNREAD = '86300000-0000-4000-8000-000000000012'
const HARBOR_EMAIL_ANCHOR = '86300000-0000-4000-8000-000000000013'
const HARBOR_URGENT = '86300000-0000-4000-8000-000000000014'

let pool: Pool

async function insertRow(
  id: string,
  propertyId: string,
  category: 'workflow_collaboration' | 'urgent_operational',
  status: 'unread' | 'read',
  minute: number,
) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'normal', $7,
       'inbox_item', $8, $9, 'Test', $10, $10
     )`,
    [
      id,
      USER,
      ORG,
      propertyId,
      category === 'urgent_operational' ? 'feedback.created' : 'reply.approved',
      category,
      status,
      `resource-${id}`,
      `event-${id}`,
      `2026-09-25T10:0${minute}:00Z`,
    ],
  )
}

async function setPropertyInApp(propertyId: string, enabled: boolean) {
  await pool.query(
    `INSERT INTO notification_preferences (
       id, user_id, organization_id, property_id, category, channel, enabled, cadence
     ) VALUES (gen_random_uuid(), $1, $2, $3, 'workflow_collaboration', 'in_app', $4, 'daily')`,
    [USER, ORG, propertyId, enabled],
  )
}

async function applyInAppEverywhere(enabled: boolean) {
  const row = createNotificationCategoryDefault(
    {
      userId: userId(USER),
      organizationId: organizationId(ORG),
      category: 'workflow_collaboration',
      channel: 'in_app',
      enabled,
      cadence: 'daily',
    },
    () => new Date('2026-09-25T11:00:00Z'),
  )
  if (row.isErr()) throw row.error
  await createNotificationPreferenceRepository(getDb()).applyCategoryDefaultEverywhere(
    row.value,
  )
}

async function removeFixtures() {
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM notification_preferences WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query(
    'DELETE FROM notification_category_defaults WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [RIVERSIDE, HARBOR])
  await deleteTestOrganizations(pool, [ORG])
}

const feedQuery = {
  userId: USER,
  organizationId: ORG,
  visiblePropertyIds: null,
  limit: 10,
  filter: 'all',
} as const

const readHead = () => createNotificationRepository(getDb()).readFeedHead(feedQuery)

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
     VALUES ($1, 'Category defaults', 'notification-category-default-feed', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Riverside Hotel', 'notification-default-riverside', 'UTC', NOW(), NOW()),
            ($2, $3, 'Harbor Inn', 'notification-default-harbor', 'UTC', NOW(), NOW())`,
    [RIVERSIDE, HARBOR, ORG],
  )
  await insertRow(RIVERSIDE_UNREAD, RIVERSIDE, 'workflow_collaboration', 'unread', 4)
  await insertRow(HARBOR_UNREAD, HARBOR, 'workflow_collaboration', 'unread', 3)
  await insertRow(HARBOR_EMAIL_ANCHOR, HARBOR, 'workflow_collaboration', 'read', 2)
  await insertRow(HARBOR_URGENT, HARBOR, 'urgent_operational', 'unread', 1)
})

describe.sequential('in-app category defaults in the feed (real PostgreSQL)', () => {
  it('keeps a muted Property muted after its in-app off is applied everywhere', async () => {
    await setPropertyInApp(RIVERSIDE, false)
    await applyInAppEverywhere(false)

    const head = await readHead()

    expect(head.page.notifications.map((row) => row.id)).toEqual([HARBOR_URGENT])
    expect(head.unreadCount).toBe(1)
  })

  it('hides email-only anchors and keyset pages under an in-app off default', async () => {
    await applyInAppEverywhere(false)

    const page = await createNotificationRepository(getDb()).readFeedPage({
      ...feedQuery,
      before: null,
    })

    expect(page.notifications.map((row) => row.id)).toEqual([HARBOR_URGENT])
  })

  it("lets a Property's own in-app on row override a default of off", async () => {
    await applyInAppEverywhere(false)
    await setPropertyInApp(HARBOR, true)

    const head = await readHead()

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      HARBOR_UNREAD,
      HARBOR_EMAIL_ANCHOR,
      HARBOR_URGENT,
    ])
    expect(head.unreadCount).toBe(2)
  })

  it("lets a Property's own in-app off row override a default of on", async () => {
    await applyInAppEverywhere(true)
    await setPropertyInApp(RIVERSIDE, false)

    const head = await readHead()

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      HARBOR_UNREAD,
      HARBOR_EMAIL_ANCHOR,
      HARBOR_URGENT,
    ])
    expect(head.unreadCount).toBe(2)
  })
})
