// The in-app feed's order and the indexes that serve it (real PostgreSQL).
//
// Order: a coalesced row reports its newest absorbed event, so it must also
// SORT by it — otherwise a re-fired escalation keeps its three-day-old slot
// while its timestamp says "just now". Ties break on id so a page boundary can
// never swap two rows that share an instant.
//
// Plans: the feed head is polled every 30 seconds per visible tab, the gap
// sweep runs every ten minutes and the retention sweep daily. Each plan is
// read for the SQL the production code actually sends (captured through the
// Drizzle logger), with sequential scans and sorts priced out so the planner
// has to show whether a matching index exists.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { createNotificationRepository } from './notification.repository'
import { createNotificationGapRepository } from './notification-gap.repository'

const ORG = 'org-notification-feed-order'
const PROPERTY = '86100000-0000-4000-8000-000000000001'
const USER = 'user-notification-feed-order'

const feedQuery = (limit: number) =>
  ({
    userId: USER,
    organizationId: ORG,
    visiblePropertyIds: null,
    limit,
    filter: 'all',
  }) as const

let pool: Pool

type Row = Readonly<{
  id: string
  createdAt: string
  coalescedLatestAt?: string
  status?: 'unread' | 'read' | 'dismissed'
  type?: string
}>

async function insertNotification(row: Row) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority,
       status, resource_type, resource_id, event_id, title,
       coalesced_count, coalesced_latest_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'urgent_operational', 'normal',
       $6, 'inbox_item', $7, $8, 'Test',
       $9, $10::timestamptz, $11::timestamptz, COALESCE($10::timestamptz, $11::timestamptz)
     )`,
    [
      row.id,
      USER,
      ORG,
      PROPERTY,
      row.type ?? 'review.created',
      row.status ?? 'unread',
      `resource-${row.id}`,
      `event-${row.id}`,
      row.coalescedLatestAt ? 2 : 1,
      row.coalescedLatestAt ?? null,
      row.createdAt,
    ],
  )
}

async function removeFixtures() {
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await deleteTestOrganizations(pool, [ORG])
}

type PlanNode = Readonly<{
  'Node Type': string
  'Index Name'?: string
  'Index Cond'?: string
  'Relation Name'?: string
  Plans?: ReadonlyArray<PlanNode>
}>

function flattenPlan(node: PlanNode): ReadonlyArray<PlanNode> {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)]
}

/**
 * Run `read` against a logging Drizzle handle and return the plan of the first
 * statement whose SQL matches `pick`, with seq scans and sorts priced out.
 */
async function planOfCapturedQuery(
  read: (db: Database) => Promise<unknown>,
  pick: (sql: string) => boolean,
): Promise<ReadonlyArray<PlanNode>> {
  const captured: { sql: string; params: unknown[] }[] = []
  const logging = drizzle(pool, {
    logger: { logQuery: (sql, params) => captured.push({ sql, params }) },
  }) as unknown as Database
  await read(logging)
  const statement = captured.find((query) => pick(query.sql))
  expect(statement, 'the production query was not captured').toBeDefined()

  const client = await pool.connect()
  try {
    await client.query('SET enable_seqscan = off')
    await client.query('SET enable_sort = off')
    const explained = await client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
      `EXPLAIN (FORMAT JSON) ${statement!.sql}`,
      statement!.params,
    )
    return flattenPlan(explained.rows[0]!['QUERY PLAN'][0].Plan)
  } finally {
    await client.query('RESET ALL')
    client.release()
  }
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
     VALUES ($1, 'Feed order', 'notification-feed-order', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Feed order property', 'notification-feed-order-property', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
})

describe.sequential('notification feed order (real PostgreSQL)', () => {
  it('lifts a coalesced row to its newest absorbed event', async () => {
    const refired = '86100000-0000-4000-8000-000000000010'
    const newer = '86100000-0000-4000-8000-000000000011'
    const newest = '86100000-0000-4000-8000-000000000012'
    await insertNotification({
      id: refired,
      type: 'inbox.escalated',
      createdAt: '2026-08-22T10:00:00Z',
      coalescedLatestAt: '2026-08-25T12:00:00Z',
    })
    await insertNotification({ id: newer, createdAt: '2026-08-25T11:00:00Z' })
    await insertNotification({ id: newest, createdAt: '2026-08-25T11:30:00Z' })

    const head = await createNotificationRepository(getDb()).readFeedHead(feedQuery(3))

    expect(head.page.notifications.map((row) => row.id)).toEqual([refired, newest, newer])
  })

  it('breaks an activity tie on id so equal instants keep one order', async () => {
    const ids = [
      '86100000-0000-4000-8000-000000000021',
      '86100000-0000-4000-8000-000000000022',
      '86100000-0000-4000-8000-000000000023',
    ]
    for (const id of ids) {
      await insertNotification({ id, createdAt: '2026-08-25T09:00:00Z' })
    }

    const head = await createNotificationRepository(getDb()).readFeedHead(feedQuery(3))

    expect(head.page.notifications.map((row) => row.id)).toEqual([...ids].reverse())
  })

  it('serves the polled feed head from an index in feed order, without a sort', async () => {
    const plan = await planOfCapturedQuery(
      (db) => createNotificationRepository(db).readFeedHead(feedQuery(20)),
      (sql) => /from "notifications"/i.test(sql) && /order by/i.test(sql),
    )

    expect(plan.map((node) => node['Index Name'])).toContain(
      'notifications_feed_activity_idx',
    )
    expect(plan.map((node) => node['Node Type'])).not.toContain('Sort')
  })

  it('continues a page after its cursor, whatever arrives or leaves above it', async () => {
    const ids = [0, 1, 2, 3, 4, 5].map((n) => `86100000-0000-4000-8000-00000000003${n}`)
    for (const [n, id] of ids.entries()) {
      await insertNotification({ id, createdAt: `2026-08-25T10:0${5 - n}:00Z` })
    }
    const repo = createNotificationRepository(getDb())
    const head = await repo.readFeedHead(feedQuery(2))
    expect(head.page.notifications.map((row) => row.id)).toEqual(ids.slice(0, 2))

    // Above the cursor, a row arrives and a head row is dismissed.
    await insertNotification({
      id: '86100000-0000-4000-8000-000000000039',
      createdAt: '2026-08-25T11:00:00Z',
    })
    await pool.query(`UPDATE notifications SET status = 'dismissed' WHERE id = $1`, [
      ids[1],
    ])

    const second = await repo.readFeedPage({
      ...feedQuery(2),
      before: head.page.nextCursor,
    })
    const third = await repo.readFeedPage({ ...feedQuery(2), before: second.nextCursor })

    expect(second.notifications.map((row) => row.id)).toEqual(ids.slice(2, 4))
    expect(third.notifications.map((row) => row.id)).toEqual(ids.slice(4, 6))
    expect(third.hasMore).toBe(false)
    expect(third.nextCursor).toBeNull()
  })

  it('keeps two rows that share a millisecond apart across a page boundary', async () => {
    // Truncated to milliseconds these would tie, and the id tiebreak would
    // put `second` first: a millisecond cursor would then skip it.
    const first = '86100000-0000-4000-8000-000000000041'
    const second = '86100000-0000-4000-8000-000000000042'
    await insertNotification({ id: first, createdAt: '2026-08-25T09:00:00.123456Z' })
    await insertNotification({ id: second, createdAt: '2026-08-25T09:00:00.123400Z' })
    const repo = createNotificationRepository(getDb())

    const head = await repo.readFeedHead(feedQuery(1))
    const next = await repo.readFeedPage({
      ...feedQuery(1),
      before: head.page.nextCursor,
    })

    expect(head.page.notifications.map((row) => row.id)).toEqual([first])
    expect(head.page.nextCursor).toEqual({ at: '2026-08-25T09:00:00.123456Z', id: first })
    expect(next.notifications.map((row) => row.id)).toEqual([second])
  })

  it('seeks a keyset page through the feed index instead of filtering it', async () => {
    const plan = await planOfCapturedQuery(
      (db) =>
        createNotificationRepository(db).readFeedPage({
          ...feedQuery(20),
          before: {
            at: '2026-08-25T09:00:00.000000Z',
            id: '86100000-0000-4000-8000-000000000099',
          },
        }),
      (sql) => /from "notifications"/i.test(sql) && /order by/i.test(sql),
    )

    const feedScan = plan.find(
      (node) => node['Index Name'] === 'notifications_feed_activity_idx',
    )
    expect(feedScan?.['Index Cond']).toContain('ROW(')
    expect(plan.map((node) => node['Node Type'])).not.toContain('Sort')
  })

  it('answers the missing-notification anti-join from an index', async () => {
    const plan = await planOfCapturedQuery(
      (db) =>
        createNotificationGapRepository(db).countItemsMissingNotifications({
          createdAtOrAfter: new Date('2026-08-24T00:00:00Z'),
          createdBefore: new Date('2026-08-25T00:00:00Z'),
          scanLimit: 50,
          statementTimeoutMs: 2_000,
        }),
      (sql) => /not exists/i.test(sql),
    )

    const notificationAccess = plan.filter(
      (node) =>
        node['Relation Name'] === 'notifications' ||
        node['Index Name']?.startsWith('notifications_'),
    )
    // The gauge's count may reach it through a bitmap heap scan, whose own node
    // names no index; what matters is that only this index is used and the
    // table is never scanned whole.
    expect(
      notificationAccess.flatMap((node) =>
        node['Index Name'] ? [node['Index Name']] : [],
      ),
    ).toEqual(['notifications_inbox_item_resource_idx'])
    expect(notificationAccess.map((node) => node['Node Type'])).not.toContain('Seq Scan')
  })

  it('selects retention candidates oldest-first from an index', async () => {
    const rule = RETENTION_RULES.find((entry) => entry.subject === 'notifications')
    expect(rule).toBeDefined()

    const plan = await planOfCapturedQuery(
      (db) =>
        executeRetentionRule(db, rule!, {
          cutoff: new Date('2000-01-01T00:00:00Z'),
          maxBatches: 1,
        }),
      (sql) => /delete from "notifications"/i.test(sql),
    )

    expect(plan.map((node) => node['Index Name'])).toContain(
      'notifications_created_at_idx',
    )
  })
})
