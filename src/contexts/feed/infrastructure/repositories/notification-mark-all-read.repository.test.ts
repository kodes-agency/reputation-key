// "Mark all read" follows the filter tab the reader is on (real PostgreSQL).
//
// It used to mark every unread row of the Organization whatever the tab: tidying
// the Workflow tab also cleared urgent Action-needed and account notices, and
// only an after-the-fact screen-reader message said so. The command now takes
// the filter, and the feed head counts the unread rows that filter holds, so
// the button can offer itself exactly when there is something to mark.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { NotificationListFilter } from '../../application/notification-list-filter'
import { createNotificationRepository } from './notification.repository'

const ORG = 'org-notification-mark-all-read'
const USER = 'user-notification-mark-all-read'
const OTHER_USER = 'user-notification-mark-all-read-other'
const PROPERTY = '86400000-0000-4000-8000-000000000001'

const URGENT_ALERT = '86400000-0000-4000-8000-000000000011'
const WORKFLOW_NOTE = '86400000-0000-4000-8000-000000000012'
const URGENT_WORKFLOW = '86400000-0000-4000-8000-000000000013'
const RECOGNITION = '86400000-0000-4000-8000-000000000014'
const ACCOUNT_NOTICE = '86400000-0000-4000-8000-000000000015'
const ALREADY_READ = '86400000-0000-4000-8000-000000000016'
const OTHER_USERS_NOTE = '86400000-0000-4000-8000-000000000017'

const MARKED_AT = new Date('2026-09-22T09:00:00.000Z')

let pool: Pool

type Row = Readonly<{
  id: string
  category: string
  priority?: 'normal' | 'urgent'
  status?: 'unread' | 'read'
  userId?: string
  /** An Organization account notice: no Property, and it is about the Organization. */
  accountNotice?: boolean
  minute: number
}>

async function insertNotification(row: Row) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $11, $5, $6, $7,
       $12, $8, $9, 'Test', $10, $10
     )`,
    [
      row.id,
      row.userId ?? USER,
      ORG,
      row.accountNotice ? null : PROPERTY,
      row.category,
      row.priority ?? 'normal',
      row.status ?? 'unread',
      row.accountNotice ? ORG : `resource-${row.id}`,
      `event-${row.id}`,
      `2026-08-25T10:${String(row.minute).padStart(2, '0')}:00Z`,
      row.accountNotice ? 'account.organization_role_changed' : 'review.created',
      row.accountNotice ? 'organization' : 'inbox_item',
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
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
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
     VALUES ($1, 'Mark all read', 'notification-mark-all-read', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Riverside', 'notification-mark-all-read-riverside', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  for (const row of [
    { id: URGENT_ALERT, category: 'urgent_operational', priority: 'urgent', minute: 6 },
    { id: WORKFLOW_NOTE, category: 'workflow_collaboration', minute: 5 },
    {
      id: URGENT_WORKFLOW,
      category: 'workflow_collaboration',
      priority: 'urgent',
      minute: 4,
    },
    { id: RECOGNITION, category: 'recognition', minute: 3 },
    { id: ACCOUNT_NOTICE, category: 'mandatory', accountNotice: true, minute: 2 },
    { id: ALREADY_READ, category: 'workflow_collaboration', status: 'read', minute: 1 },
    {
      id: OTHER_USERS_NOTE,
      category: 'workflow_collaboration',
      userId: OTHER_USER,
      minute: 0,
    },
  ] as const satisfies ReadonlyArray<Row>) {
    await insertNotification(row)
  }
})

const markAllRead = (filter: NotificationListFilter) =>
  createNotificationRepository(getDb()).markAllRead(USER, ORG, filter, MARKED_AT)

describe.sequential('"Mark all read" scoped to the filter (real PostgreSQL)', () => {
  it('on a category tab, marks only that category and leaves urgent and account notices unread', async () => {
    await markAllRead('workflow_collaboration')

    expect(await statuses()).toEqual({
      [URGENT_ALERT]: 'unread',
      [WORKFLOW_NOTE]: 'read',
      [URGENT_WORKFLOW]: 'read',
      [RECOGNITION]: 'unread',
      [ACCOUNT_NOTICE]: 'unread',
      [ALREADY_READ]: 'read',
      [OTHER_USERS_NOTE]: 'unread',
    })
    const readAt = await pool.query<{ read_at: Date }>(
      'SELECT read_at FROM notifications WHERE id = $1',
      [WORKFLOW_NOTE],
    )
    expect(readAt.rows[0]?.read_at).toEqual(MARKED_AT)
  })

  it('on Urgent, marks urgent rows of every category and nothing else', async () => {
    await markAllRead('urgent')

    expect(await statuses()).toMatchObject({
      [URGENT_ALERT]: 'read',
      [WORKFLOW_NOTE]: 'unread',
      [URGENT_WORKFLOW]: 'read',
      [RECOGNITION]: 'unread',
      [ACCOUNT_NOTICE]: 'unread',
      [OTHER_USERS_NOTE]: 'unread',
    })
  })

  it.each(['all', 'unread'] as const)(
    'on %s, marks every unread row of the reader and no one else',
    async (filter) => {
      await markAllRead(filter)

      expect(await statuses()).toEqual({
        [URGENT_ALERT]: 'read',
        [WORKFLOW_NOTE]: 'read',
        [URGENT_WORKFLOW]: 'read',
        [RECOGNITION]: 'read',
        [ACCOUNT_NOTICE]: 'read',
        [ALREADY_READ]: 'read',
        [OTHER_USERS_NOTE]: 'unread',
      })
    },
  )

  it("counts the unread rows the reader's filter holds in the head's snapshot", async () => {
    const repo = createNotificationRepository(getDb())
    const head = (
      filter: NotificationListFilter,
      visiblePropertyIds: ReadonlyArray<string> | null = null,
    ) =>
      repo.readFeedHead({
        userId: USER,
        organizationId: ORG,
        visiblePropertyIds,
        limit: 1,
        filter,
      })

    const counts = async (filter: NotificationListFilter) => {
      const { unreadCount, filterUnreadCount } = await head(filter)
      return { unreadCount, filterUnreadCount }
    }
    expect(await counts('all')).toEqual({ unreadCount: 5, filterUnreadCount: 5 })
    expect(await counts('unread')).toEqual({ unreadCount: 5, filterUnreadCount: 5 })
    expect(await counts('urgent')).toEqual({ unreadCount: 5, filterUnreadCount: 2 })
    expect(await counts('workflow_collaboration')).toEqual({
      unreadCount: 5,
      filterUnreadCount: 2,
    })
    expect(await counts('mandatory')).toEqual({ unreadCount: 5, filterUnreadCount: 1 })

    // A reader who can no longer access the Property sees only the account notice.
    const hidden = await head('workflow_collaboration', [])
    expect(hidden.unreadCount).toBe(1)
    expect(hidden.filterUnreadCount).toBe(0)
  })
})
