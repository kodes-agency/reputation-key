// The recovery read: published facts, recent enough that the redelivery sweep
// has not reached them, still missing a catalogued consumer receipt — the set
// a Queue Redis loss can strand (real PostgreSQL).

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from './infrastructure/outbox-repository'
import { createPublishedAwaitingReceiptsReader } from './infrastructure/published-awaiting-receipts'

const db = getDb()
const repo = createOutboxRepository(db)
const read = createPublishedAwaitingReceiptsReader(db)
const ORG = 'org-published-awaiting-receipts'
const EVENT_TYPE = 'test.published-awaiting-receipts'
const CONSUMER = 'test.awaiting-consumer'
const MINUTE = 60_000

async function clean(): Promise<void> {
  await db.execute(sql`
    DELETE FROM event_consumer_receipts
    WHERE event_id IN (SELECT id FROM outbox_events WHERE organization_id = ${ORG})
  `)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
}

async function insertEvent(minutesAgo: number, published: boolean): Promise<string> {
  const publishedAt = new Date(Date.now() - minutesAgo * MINUTE)
  const result = await db.execute(sql`
    INSERT INTO outbox_events (
      event_type, event_version, payload, organization_id, source_context,
      source_aggregate_id, created_at, published_at
    ) VALUES (
      ${EVENT_TYPE}, 1, '{}'::jsonb, ${ORG}, 'test', 'aggregate-awaiting',
      ${new Date(publishedAt.getTime() - 1_000)}, ${published ? publishedAt : null}
    )
    RETURNING id
  `)
  const id = result.rows[0]?.id
  if (typeof id !== 'string') throw new Error('fixture insert returned no id')
  return id
}

beforeEach(clean)
afterAll(clean)

describe('published facts awaiting receipts', () => {
  it('returns recent published facts a catalogued consumer has not receipted', async () => {
    const stranded = await insertEvent(40, true)
    const laterStranded = await insertEvent(10, true)
    const receipted = await insertEvent(30, true)
    await repo.insertReceipt(receipted, CONSUMER, 'applied')
    await insertEvent(20, false) // the relay's, not recovery's
    await insertEvent(3 * 60, true) // the two-hour redelivery sweep's

    const input = {
      consumerExpectations: [{ eventType: EVENT_TYPE, consumerName: CONSUMER }],
      publishedAfter: new Date(Date.now() - 2 * 60 * MINUTE),
      after: null,
      limit: 1,
    }
    const first = await read(input)
    const second = await read({
      ...input,
      after: { publishedAt: first[0]!.publishedAt, id: first[0]!.id },
    })
    const third = await read({
      ...input,
      after: { publishedAt: second[0]!.publishedAt, id: second[0]!.id },
    })

    expect(first.map((row) => row.id)).toEqual([stranded])
    expect(second.map((row) => row.id)).toEqual([laterStranded])
    expect(third).toEqual([])
    expect(first[0]).toMatchObject({ eventType: EVENT_TYPE, organizationId: ORG })
  })
})
