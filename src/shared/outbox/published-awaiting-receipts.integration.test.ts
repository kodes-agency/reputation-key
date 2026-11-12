// The receipt sweep must make bounded progress across the entire published
// backlog, including facts outside any recent publication window, while the
// per-second poll reads unpublished facts only.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import type { AwaitingReceiptsCursor } from './infrastructure/delivery.server'
import { createOutboxRepository } from './infrastructure/outbox-repository'
import { createOutboxRelay } from './relay'

const db = getDb()
const repo = createOutboxRepository(db)
const ORG = 'org-published-awaiting-receipts'
const OTHER_ORG = 'org-published-awaiting-receipts-other'
const EVENT_TYPE = 'test.published-awaiting-receipts'
const CONSUMER = 'test.awaiting-consumer'
const MINUTE = 60_000
const EXPECTED = [{ eventType: EVENT_TYPE, consumerName: CONSUMER }]

const sweep = (sweepPageSize: number, consumerExpectations = EXPECTED) =>
  createOutboxRelay(repo, undefined, { sweepPageSize, consumerExpectations }).sweep()

async function clean(): Promise<void> {
  // Admission scans the whole scratch database, including unpublished facts
  // from other families. Keep these exact-count cases a closed-world backlog.
  await db.execute(sql`DELETE FROM work_items WHERE kind = 'outbox-delivery'`)
  await db.execute(sql`DELETE FROM outbox_events`)
}

async function insertEvent(
  minutesAgo: number,
  published: boolean,
  organizationId = ORG,
): Promise<string> {
  const publishedAt = new Date(Date.now() - minutesAgo * MINUTE)
  return insertAt(
    new Date(publishedAt.getTime() - 1_000),
    published ? sql`${publishedAt}::timestamptz` : sql`NULL`,
    organizationId,
  )
}

async function insertAt(
  createdAt: Date,
  publishedAt: SQL,
  organizationId = ORG,
  id: SQL = sql`gen_random_uuid()`,
): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, source_context,
      source_aggregate_id, created_at, published_at
    ) VALUES (
      ${id}, ${EVENT_TYPE}, 1, '{}'::jsonb, ${organizationId}, 'test',
      'aggregate-awaiting', ${createdAt}, ${publishedAt}
    ) RETURNING id
  `)
  const row = result.rows[0]?.id
  if (typeof row !== 'string') throw new Error('fixture insert returned no id')
  return row
}

beforeEach(clean)
afterAll(clean)

describe('published facts awaiting durable delivery', () => {
  it('advances through bounded pages without skipping facts outside a time window', async () => {
    const stranded = await insertEvent(40, true)
    const laterStranded = await insertEvent(10, true)
    const receipted = await insertEvent(30, true)
    await repo.insertReceipt(receipted, CONSUMER, 'applied')
    const unpublished = await insertEvent(20, false)
    const old = await insertEvent(3 * 60, true)

    const admitted = await sweep(1)

    expect(admitted.map(({ subjectId }) => subjectId).sort()).toEqual(
      [stranded, laterStranded, old].sort(),
    )
    expect(admitted.every(({ organizationId }) => organizationId === ORG)).toBe(true)
    expect(await sweep(1)).toEqual([])
    const polled = await repo.delivery.schedulePending(10)
    expect(polled.map(({ subjectId }) => subjectId)).toEqual([unpublished])
  })

  it('never reads a published fact in the per-second poll', async () => {
    const stranded = await insertEvent(40, true)
    const unpublished = await insertEvent(20, false)

    const polled = await repo.delivery.schedulePending(10)

    expect(polled.map(({ subjectId }) => subjectId)).toEqual([unpublished])
    expect(await repo.delivery.schedulePending(10)).toEqual([])
    const swept = await sweep(10)
    expect(swept.map(({ subjectId }) => subjectId)).toEqual([stranded])
  })

  it('pages across facts published within the same millisecond', async () => {
    // Microseconds ordered against the ids: a cursor or an order on the raw
    // time would return the second row again or skip it.
    const instant = '2026-11-01 10:00:00.123'
    const first = await insertAt(
      new Date('2026-11-01T09:59:00.000Z'),
      sql`${instant + '900+00'}::timestamptz`,
      ORG,
      sql`'00000000-0000-4000-8000-000000000001'::uuid`,
    )
    const second = await insertAt(
      new Date('2026-11-01T09:59:00.000Z'),
      sql`${instant + '100+00'}::timestamptz`,
      ORG,
      sql`'00000000-0000-4000-8000-000000000002'::uuid`,
    )
    const later = await insertAt(
      new Date('2026-11-01T09:59:00.000Z'),
      sql`'2026-11-01 10:00:00.124+00'::timestamptz`,
    )

    const pages: string[][] = []
    let after: AwaitingReceiptsCursor | null = null
    do {
      const page = await repo.delivery.scheduleAwaitingReceipts(after, 1, EXPECTED)
      pages.push(page.scheduled.map(({ subjectId }) => subjectId))
      after = page.next
      expect(pages.length).toBeLessThanOrEqual(4)
    } while (after)

    expect(pages).toEqual([[first], [second], [later], []])
    expect(await sweep(1)).toEqual([])
  })

  it('re-admits a published fact whose delivery work is gone until its receipt exists', async () => {
    const stranded = await insertEvent(40, true)
    expect((await sweep(1)).map(({ subjectId }) => subjectId)).toEqual([stranded])
    // Losing the work row (a restore, a manual repair) leaves the receipt owed.
    await db.execute(sql`DELETE FROM work_items WHERE kind = 'outbox-delivery'`)
    expect((await sweep(1)).map(({ subjectId }) => subjectId)).toEqual([stranded])
    await db.execute(sql`DELETE FROM work_items WHERE kind = 'outbox-delivery'`)
    await repo.insertReceipt(stranded, CONSUMER, 'applied')
    expect(await sweep(1)).toEqual([])
  })

  it('never back-fills a fact that has delivery work to a consumer added later', async () => {
    const admittedEarlier = await insertEvent(40, false)
    const [work] = await repo.delivery.schedulePending(1)
    expect(work?.subjectId).toBe(admittedEarlier)
    await repo.insertReceipt(admittedEarlier, CONSUMER, 'applied')

    expect(
      await sweep(10, [
        ...EXPECTED,
        { eventType: EVENT_TYPE, consumerName: 'test.later-consumer' },
      ]),
    ).toEqual([])
  })

  it('admits every tenant backlog in one pass', async () => {
    const busyTenantFacts = await Promise.all(
      Array.from({ length: 6 }, (_, index) => insertEvent(100 + index, true)),
    )
    const other = await insertEvent(1, true, OTHER_ORG)

    const admitted = await sweep(2)

    expect(admitted.map(({ subjectId }) => subjectId).sort()).toEqual(
      [...busyTenantFacts, other].sort(),
    )
  })

  it('gives another tenant a turn before draining one tenant backlog', async () => {
    const busyTenantFacts = await Promise.all(
      Array.from({ length: 6 }, (_, index) => insertEvent(100 + index, false)),
    )
    const other = await insertEvent(1, false, OTHER_ORG)
    const batch = await repo.delivery.schedulePending(2)

    expect(batch).toHaveLength(2)
    expect(batch.map(({ organizationId }) => organizationId).sort()).toEqual(
      [ORG, OTHER_ORG].sort(),
    )
    expect(batch.map(({ subjectId }) => subjectId)).toContain(other)
    expect(
      batch.filter(({ subjectId }) => busyTenantFacts.includes(subjectId)),
    ).toHaveLength(1)
  })

  it('requires every expected receipt before excluding a fact from adoption', async () => {
    const partial = await insertEvent(40, true)
    const settled = await insertEvent(30, true)
    await repo.insertReceipt(partial, CONSUMER, 'applied')
    await repo.insertReceipt(settled, CONSUMER, 'applied')
    await repo.insertReceipt(settled, 'test.second-consumer', 'obsolete')
    const batch = await sweep(10, [
      ...EXPECTED,
      { eventType: EVENT_TYPE, consumerName: 'test.second-consumer' },
    ])

    expect(batch.map(({ subjectId }) => subjectId)).toEqual([partial])
  })
})
