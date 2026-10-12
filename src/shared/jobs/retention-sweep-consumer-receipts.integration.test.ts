// Consumer receipts against real PostgreSQL. A receipt is the dispatcher's only
// proof that a consumer already handled a fact, and the five-minute redelivery
// sweep replays every published fact that lacks one, however old it is. So a
// receipt must never leave before its fact. These cases run the retention
// sweep's own rules for the two tables and then the redelivery sweep itself:
// whatever the retention run did (took its time, failed on the fact rule,
// stopped at its per-run cap), no fact that is still stored may be replayed.

import { sql } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { DEFAULT_MAX_BATCHES_PER_RUN } from '#/shared/db/retention/execute-retention-rule'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  createPublishedEventRedeliveryHandler,
  type PublishedEventRedeliveryQueue,
} from '#/shared/outbox/published-event-redelivery.job'
import { createRetentionSweepHandler, RETENTION_RULES } from './retention-sweep.job'

const db = getDb()
const repo = createOutboxRepository(db)
const EVENT_TYPE = 'test.receipt-retention'
const CONSUMER = 'test.receipt-retention-consumer'
const AUDIT_ONLY_EVENT_TYPE = 'test.receipt-retention-audit-only'
const NOW = new Date('2026-10-12T03:00:00.000Z')
const SECOND_MS = 1_000
const DAY_MS = 24 * 60 * 60 * SECOND_MS
const OUTBOX_RETENTION_MS = 30 * DAY_MS
/** The fact rule and whatever the sweep runs for receipts, in the sweep's order. */
const OUTBOX_TABLES: ReadonlySet<string> = new Set([
  'outbox_events',
  'event_consumer_receipts',
])
const outboxRules = RETENTION_RULES.filter(({ table }) => OUTBOX_TABLES.has(table))
const SUBJECTS = outboxRules.map(({ subject }) => subject)

async function clean(): Promise<void> {
  await db.execute(sql`DELETE FROM event_consumer_receipts`)
  await db.execute(sql`DELETE FROM outbox_events`)
  await db.execute(sql`
    DELETE FROM retention_runs
    WHERE started_at >= ${NOW}
      AND started_at < ${new Date(NOW.getTime() + DAY_MS)}
      AND subject IN (${sql.join(
        SUBJECTS.map((subject) => sql`${subject}`),
        sql`, `,
      )})
  `)
}

async function insertPublishedFact(
  publishedAt: Date,
  eventType: string = EVENT_TYPE,
): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO outbox_events (
      event_type, event_version, payload, organization_id, source_context,
      source_aggregate_id, created_at, published_at
    ) VALUES (
      ${eventType}, 1, '{"resourceId":"receipt-retention-fixture"}'::jsonb,
      'org-receipt-retention-test', 'test', 'aggregate-receipt-retention-test',
      ${new Date(publishedAt.getTime() - SECOND_MS)}, ${publishedAt}
    )
    RETURNING id
  `)
  const row = result.rows[0]
  if (!row || typeof row.id !== 'string') throw new Error('fixture insert returned no id')
  return row.id
}

async function insertReceipt(eventId: string, createdAt: Date): Promise<void> {
  await db.execute(sql`
    INSERT INTO event_consumer_receipts (event_id, consumer_name, status, created_at)
    VALUES (${eventId}::uuid, ${CONSUMER}, 'applied', ${createdAt})
  `)
}

async function storedFactIds(): Promise<ReadonlyArray<string>> {
  const result = await db.execute<{ id: string }>(
    sql`SELECT id FROM outbox_events WHERE event_type = ${EVENT_TYPE} ORDER BY published_at`,
  )
  return result.rows.map(({ id }) => id)
}

async function receiptedFactIds(): Promise<ReadonlyArray<string>> {
  const result = await db.execute<{ event_id: string }>(
    sql`SELECT event_id FROM event_consumer_receipts WHERE consumer_name = ${CONSUMER}`,
  )
  return result.rows.map((row) => row.event_id)
}

/** A clock that moves one second on every read, as a run that takes time does. */
function tickingClock(): () => Date {
  let reads = 0
  return () => new Date(NOW.getTime() + reads++ * SECOND_MS)
}

/** Runs the redelivery sweep after the retention run and returns what it replays. */
async function factsRedelivered(): Promise<ReadonlyArray<unknown>> {
  const replayed: unknown[] = []
  const queue: PublishedEventRedeliveryQueue = {
    add: async (_name, data) => {
      replayed.push(data)
      return undefined
    },
  }
  const redeliver = createPublishedEventRedeliveryHandler({
    repo,
    queue,
    clock: () => new Date(NOW.getTime() + DAY_MS / 2),
    logger: { info: vi.fn(), warn: vi.fn() },
    consumerExpectations: [{ eventType: EVENT_TYPE, consumerName: CONSUMER }],
  })
  await redeliver({} as Job)
  return replayed
}

beforeEach(clean)
afterAll(clean)

describe.sequential('consumer receipt retention (real PostgreSQL)', () => {
  it('keeps the receipt of a fact published just inside the window, however long the rules before it run', async () => {
    // Published one second inside the fact rule's 30 days and receipted half a
    // second later: a receipt rule that starts two seconds after the fact rule
    // would see the receipt as expired and the fact as live.
    const publishedAt = new Date(NOW.getTime() - OUTBOX_RETENTION_MS + SECOND_MS)
    const fact = await insertPublishedFact(publishedAt)
    await insertReceipt(fact, new Date(publishedAt.getTime() + SECOND_MS / 2))

    await createRetentionSweepHandler({
      db,
      clock: tickingClock(),
      rules: outboxRules,
    })({} as Job)

    expect(await storedFactIds()).toEqual([fact])
    expect(await factsRedelivered()).toEqual([])
    expect(await receiptedFactIds()).toEqual([fact])
  })

  it('keeps the receipt of an expired fact when the fact rule fails', async () => {
    const publishedAt = new Date(NOW.getTime() - OUTBOX_RETENTION_MS - DAY_MS)
    const fact = await insertPublishedFact(publishedAt)
    await insertReceipt(fact, publishedAt)
    const rulesWithFailingFactRule = outboxRules.map((rule) =>
      rule.table === 'outbox_events'
        ? { ...rule, table: 'outbox_events_unavailable' }
        : rule,
    )

    await expect(
      createRetentionSweepHandler({
        db,
        clock: () => NOW,
        rules: rulesWithFailingFactRule,
      })({} as Job),
    ).rejects.toThrow(/1 rule\(s\) failed: outbox_events\.published/)

    expect(await storedFactIds()).toEqual([fact])
    expect(await factsRedelivered()).toEqual([])
    expect(await receiptedFactIds()).toEqual([fact])
  })

  it('keeps the receipt of an expired fact that a capped run leaves for the next one', async () => {
    // Facts with no consumer have no receipt, so they can fill the fact rule's
    // per-run cap on their own and leave a receipted fact behind them.
    const expiredAt = new Date(NOW.getTime() - OUTBOX_RETENTION_MS - DAY_MS)
    for (let index = 0; index < DEFAULT_MAX_BATCHES_PER_RUN; index += 1) {
      await insertPublishedFact(
        new Date(expiredAt.getTime() - (index + 1) * SECOND_MS),
        AUDIT_ONLY_EVENT_TYPE,
      )
    }
    const fact = await insertPublishedFact(expiredAt)
    await insertReceipt(fact, expiredAt)

    await createRetentionSweepHandler({
      db,
      clock: () => NOW,
      rules: outboxRules,
      batchSize: 1,
    })({} as Job)

    expect(await storedFactIds()).toEqual([fact])
    expect(await factsRedelivered()).toEqual([])
    expect(await receiptedFactIds()).toEqual([fact])
  })

  it('removes a receipt in the same run as its fact and leaves a live fact its receipt', async () => {
    const expiredAt = new Date(NOW.getTime() - OUTBOX_RETENTION_MS - DAY_MS)
    const liveAt = new Date(NOW.getTime() - DAY_MS)
    const expired = await insertPublishedFact(expiredAt)
    await insertReceipt(expired, expiredAt)
    const live = await insertPublishedFact(liveAt)
    await insertReceipt(live, liveAt)

    await createRetentionSweepHandler({
      db,
      clock: () => NOW,
      rules: outboxRules,
    })({} as Job)

    expect(await storedFactIds()).toEqual([live])
    expect(await factsRedelivered()).toEqual([])
    expect(await receiptedFactIds()).toEqual([live])
  })
})
