import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from './infrastructure/outbox-repository'

const db = getDb()
const ORG = 'org-published-redelivery-test'
const EVENT_TYPE = 'test.published-redelivery'
const CONSUMER = 'test.redelivery-consumer'
const NOW = new Date('2026-09-10T12:00:00.000Z')
const HOUR = 60 * 60 * 1_000
const EXPECTED = [{ eventType: EVENT_TYPE, consumerName: CONSUMER }]
let currentTime = NOW
const repo = createOutboxRepository(db, () => currentTime)

async function clean(): Promise<void> {
  // Admission scans the whole scratch database, including unpublished facts
  // from other families. Keep these exact-count cases a closed-world backlog.
  await db.execute(sql`DELETE FROM work_items WHERE kind = 'outbox-delivery'`)
  await db.execute(sql`DELETE FROM outbox_events`)
  currentTime = NOW
}

async function insertPublishedEvent(publishedAt: Date): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO outbox_events (
      event_type, event_version, payload, organization_id, source_context,
      source_aggregate_id, created_at, published_at
    ) VALUES (
      ${EVENT_TYPE}, 1, '{"resourceId":"redelivery-fixture"}'::jsonb,
      ${ORG}, 'test', 'aggregate-redelivery-test',
      ${new Date(publishedAt.getTime() - 1_000)}, ${publishedAt}
    ) RETURNING id
  `)
  const id = result.rows[0]?.id
  if (typeof id !== 'string') throw new Error('fixture insert returned no id')
  return id
}

beforeEach(clean)
afterAll(clean)

describe('published fact delivery through durable work', () => {
  it('adopts missing receipts once without an age window or an enqueue attempt charge', async () => {
    const stranded = await insertPublishedEvent(new Date(NOW.getTime() - 3 * HOUR))
    const receipted = await insertPublishedEvent(new Date(NOW.getTime() - 3 * HOUR))
    const fresh = await insertPublishedEvent(new Date(NOW.getTime() - HOUR))
    await repo.insertReceipt(receipted, CONSUMER, 'applied')

    const admitted = await repo.delivery.schedulePending(10, EXPECTED)
    expect(admitted.map(({ subjectId }) => subjectId).sort()).toEqual(
      [stranded, fresh].sort(),
    )
    for (const work of admitted) {
      expect(await repo.delivery.workItems.inspect(ORG, work.id)).toMatchObject({
        state: 'pending',
        attempts: 0,
        recovery: 'retry',
        subjectId: work.subjectId,
      })
    }
    expect(await repo.delivery.schedulePending(10, EXPECTED)).toEqual([])
    currentTime = new Date(NOW.getTime() + 8 * HOUR)
    expect(await repo.delivery.schedulePending(10, EXPECTED)).toEqual([])
  })

  it('bounds actual handler claims and preserves the unresolved fact when work is quarantined', async () => {
    const eventId = await insertPublishedEvent(new Date(NOW.getTime() - 3 * HOUR))
    const [work] = await repo.delivery.schedulePending(10, EXPECTED)
    if (!work) throw new Error('missing delivery work')
    const initial = await repo.delivery.workItems.inspect(ORG, work.id)
    if (!initial) throw new Error('missing work row')

    for (let attempt = 1; attempt <= initial.maxAttempts; attempt++) {
      const claimed = await repo.delivery.workItems.claim(ORG, work.id, 60_000)
      expect(claimed).toMatchObject({ state: 'running', attempts: attempt })
      if (!claimed?.leaseToken) throw new Error('claim returned no lease')
      await repo.delivery.workItems.fail(ORG, work.id, claimed.leaseToken)
      currentTime = new Date(currentTime.getTime() + 60_000)
    }

    expect(await repo.delivery.workItems.inspect(ORG, work.id)).toMatchObject({
      state: 'quarantined',
      attempts: initial.maxAttempts,
      errorCode: 'attempts_exhausted',
    })
    expect(await repo.delivery.workItems.claim(ORG, work.id, 60_000)).toBeUndefined()
    expect(await repo.delivery.schedulePending(10, EXPECTED)).toEqual([])
    expect(await repo.hasReceipt(eventId, CONSUMER)).toBe(false)
    expect(
      (await db.execute(sql`SELECT id FROM outbox_events WHERE id = ${eventId}::uuid`))
        .rows,
    ).toHaveLength(1)
  })
})
