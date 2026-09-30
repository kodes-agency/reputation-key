// The /notifications page's Property filter (real PostgreSQL,
// docs/design/notifications, direction B).
//
// A manager of many properties reads one Property's notices at a time. The
// filter is one more condition beside current Property access, so it can only
// ever narrow what the reader already sees: a Property whose access ended
// reads as empty, Organization-scoped notices (no Property) are left out, and
// "Mark all read" and "Dismiss all" change the filtered rows and nothing else.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createNotificationRepository } from './notification.repository'

const ORG = 'org-notification-property-filter'
const USER = 'user-notification-property-filter'
const OTHER_USER = 'user-notification-property-filter-other'
const OTHER_ORG = 'org-notification-property-filter-other'
const FOREIGN = '86600000-0000-4000-8000-000000000004'
const HARBOUR = '86600000-0000-4000-8000-000000000001'
const RIVERSIDE = '86600000-0000-4000-8000-000000000002'
const REVOKED = '86600000-0000-4000-8000-000000000003'

const HARBOUR_NEWER = '86600000-0000-4000-8000-000000000011'
const HARBOUR_OLDER = '86600000-0000-4000-8000-000000000012'
const RIVERSIDE_ROW = '86600000-0000-4000-8000-000000000013'
const REVOKED_ROW = '86600000-0000-4000-8000-000000000014'
const ACCOUNT_NOTICE = '86600000-0000-4000-8000-000000000015'
const OTHER_READERS_ROW = '86600000-0000-4000-8000-000000000016'
const FOREIGN_ROW = '86600000-0000-4000-8000-000000000017'

const AT = new Date('2026-09-30T09:00:00.000Z')
const SCOPE = {
  userId: userId(USER),
  organizationId: organizationId(ORG),
  visiblePropertyIds: [propertyId(HARBOUR), propertyId(RIVERSIDE)],
}
const query = (property: string | null) => ({
  ...SCOPE,
  propertyId: property === null ? null : propertyId(property),
  filter: 'all' as const,
  limit: 10,
})

let pool: Pool

async function insertNotification(
  id: string,
  property: string | null,
  minute: number,
  owner: Readonly<{ user: string; org: string }> = { user: USER, org: ORG },
) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'normal', 'unread', $7, $8, $9, 'Test', $10, $10)`,
    [
      id,
      owner.user,
      owner.org,
      property,
      property ? 'inbox_note.added' : 'account.organization_role_changed',
      property ? 'workflow_collaboration' : 'mandatory',
      property ? 'inbox_item' : 'organization',
      property ? `resource-${id}` : ORG,
      `event-${id}`,
      `2026-09-30T08:${String(minute).padStart(2, '0')}:00Z`,
    ],
  )
}

async function statuses(): Promise<Record<string, string>> {
  const result = await pool.query<{ id: string; status: string }>(
    'SELECT id, status FROM notifications WHERE organization_id = ANY($1::text[])',
    [[ORG, OTHER_ORG]],
  )
  return Object.fromEntries(result.rows.map((row) => [row.id, row.status]))
}

async function cleanUp() {
  for (const org of [ORG, OTHER_ORG]) {
    await pool.query('DELETE FROM notifications WHERE organization_id = $1', [org])
    await pool.query('DELETE FROM properties WHERE organization_id = $1', [org])
  }
  await deleteTestOrganizations(pool, [ORG, OTHER_ORG])
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
  for (const [org, slug] of [
    [ORG, 'notification-property-filter'],
    [OTHER_ORG, 'notification-property-filter-other'],
  ]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Property filter', $2, NOW())`,
      [org, slug],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Foreign', 'notification-property-filter-foreign', 'UTC', NOW(), NOW())`,
    [FOREIGN, OTHER_ORG],
  )
  for (const [id, slug] of [
    [HARBOUR, 'harbour'],
    [RIVERSIDE, 'riverside'],
    [REVOKED, 'revoked'],
  ]) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())`,
      [id, ORG, slug, `notification-property-filter-${slug}`],
    )
  }
  await insertNotification(HARBOUR_NEWER, HARBOUR, 5)
  await insertNotification(HARBOUR_OLDER, HARBOUR, 4)
  await insertNotification(RIVERSIDE_ROW, RIVERSIDE, 3)
  await insertNotification(REVOKED_ROW, REVOKED, 2)
  await insertNotification(ACCOUNT_NOTICE, null, 1)
  // Somebody else's row at the same Property, and this reader's row in
  // another Organization: the filter narrows, it never reaches either.
  await insertNotification(OTHER_READERS_ROW, HARBOUR, 6, { user: OTHER_USER, org: ORG })
  await insertNotification(FOREIGN_ROW, FOREIGN, 7, { user: USER, org: OTHER_ORG })
})

describe.sequential('the page reads one Property at a time (real PostgreSQL)', () => {
  it('lists and counts only that Property, leaving Organization notices out', async () => {
    const repo = createNotificationRepository(getDb())

    const head = await repo.readFeedHead(query(HARBOUR))
    const page = await repo.readFeedPage({ ...query(HARBOUR), before: null })

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      HARBOUR_NEWER,
      HARBOUR_OLDER,
    ])
    expect(page.notifications.map((row) => row.id)).toEqual([
      HARBOUR_NEWER,
      HARBOUR_OLDER,
    ])
    expect(head.unreadCount).toBe(2)
    expect(head.filterUnreadCount).toBe(2)
  })

  it("reads another Organization's Property as empty, even for an Organization-wide reader", async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead({
      ...query(FOREIGN),
      visiblePropertyIds: null,
    })

    expect(head.page.notifications).toEqual([])
    expect(head.unreadCount).toBe(0)
  })

  it('reads a Property the reader can no longer access as empty', async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead(query(REVOKED))

    expect(head.page.notifications).toEqual([])
    expect(head.unreadCount).toBe(0)
  })

  it('reads the whole visible feed without a Property filter', async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead(query(null))

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      HARBOUR_NEWER,
      HARBOUR_OLDER,
      RIVERSIDE_ROW,
      ACCOUNT_NOTICE,
    ])
  })

  it('"Mark all read" under the filter changes only that Property', async () => {
    await createNotificationRepository(getDb()).markAllRead(
      { ...SCOPE, propertyId: propertyId(HARBOUR) },
      'all',
      AT,
    )

    expect(await statuses()).toEqual({
      [HARBOUR_NEWER]: 'read',
      [HARBOUR_OLDER]: 'read',
      [RIVERSIDE_ROW]: 'unread',
      [REVOKED_ROW]: 'unread',
      [ACCOUNT_NOTICE]: 'unread',
      [OTHER_READERS_ROW]: 'unread',
      [FOREIGN_ROW]: 'unread',
    })
  })

  it('"Dismiss all" under the filter changes only that Property', async () => {
    await createNotificationRepository(getDb()).markAllDismissed(
      { ...SCOPE, propertyId: propertyId(RIVERSIDE) },
      AT,
    )

    expect(await statuses()).toEqual({
      [HARBOUR_NEWER]: 'unread',
      [HARBOUR_OLDER]: 'unread',
      [RIVERSIDE_ROW]: 'dismissed',
      [REVOKED_ROW]: 'unread',
      [ACCOUNT_NOTICE]: 'unread',
      [OTHER_READERS_ROW]: 'unread',
      [FOREIGN_ROW]: 'unread',
    })
  })
})
