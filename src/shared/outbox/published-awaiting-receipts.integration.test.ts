// Admission must make bounded progress across the entire published backlog,
// including facts outside any recent publication window.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from './infrastructure/outbox-repository'

const db = getDb()
const repo = createOutboxRepository(db)
const ORG = 'org-published-awaiting-receipts'
const OTHER_ORG = 'org-published-awaiting-receipts-other'
const EVENT_TYPE = 'test.published-awaiting-receipts'
const CONSUMER = 'test.awaiting-consumer'
const MINUTE = 60_000
const EXPECTED = [{ eventType: EVENT_TYPE, consumerName: CONSUMER }]

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
  const result = await db.execute(sql`
    INSERT INTO outbox_events (
      event_type, event_version, payload, organization_id, source_context,
      source_aggregate_id, created_at, published_at
    ) VALUES (
      ${EVENT_TYPE}, 1, '{}'::jsonb, ${organizationId}, 'test', 'aggregate-awaiting',
      ${new Date(publishedAt.getTime() - 1_000)}, ${published ? publishedAt : null}
    ) RETURNING id
  `)
  const id = result.rows[0]?.id
  if (typeof id !== 'string') throw new Error('fixture insert returned no id')
  return id
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

    const admitted = []
    for (let page = 0; page < 4; page++) {
      const next = await repo.delivery.schedulePending(1, EXPECTED)
      expect(next).toHaveLength(1)
      admitted.push(next[0]!)
    }
    expect(await repo.delivery.schedulePending(1, EXPECTED)).toEqual([])
    expect(admitted.map(({ subjectId }) => subjectId).sort()).toEqual(
      [stranded, laterStranded, unpublished, old].sort(),
    )
    expect(admitted.every(({ organizationId }) => organizationId === ORG)).toBe(true)
  })

  it('gives another tenant a turn before draining one tenant backlog', async () => {
    const busyTenantFacts = await Promise.all(
      Array.from({ length: 6 }, (_, index) => insertEvent(100 + index, true)),
    )
    const other = await insertEvent(1, true, OTHER_ORG)
    const batch = await repo.delivery.schedulePending(2, EXPECTED)

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
    const batch = await repo.delivery.schedulePending(10, [
      ...EXPECTED,
      { eventType: EVENT_TYPE, consumerName: 'test.second-consumer' },
    ])

    expect(batch.map(({ subjectId }) => subjectId)).toEqual([partial])
  })
})
