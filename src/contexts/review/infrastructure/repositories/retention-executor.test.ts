// BQC-1.6 — retention executor integration test (real PostgreSQL).
// Proves the id-IN-subquery pattern deletes old rows in bounded batches,
// keeps recent rows, handles composite keys, and is safe to re-run.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeRetentionRule } from '../../../../shared/db/retention/execute-retention-rule'

const db = getDb()
const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

beforeAll(async () => {
  await db.execute(sql`DELETE FROM event_consumer_receipts`)
  await db.execute(sql`DELETE FROM outbox_events`)
  await db.execute(sql`DELETE FROM review_sync_runs`)
  // 3 old + 2 recent sync runs
  for (let i = 0; i < 5; i++) {
    const age = i < 3 ? 40 * DAY : 1 * DAY
    await db.execute(sql`
      INSERT INTO review_sync_runs (id, property_id, source, mode, started_at)
      VALUES (gen_random_uuid(), 'prop-ret-test', 'google', 'incremental',
              ${new Date(NOW - age)})
    `)
  }
  // 2 old + 2 recent receipts (composite PK, FK → outbox_events)
  for (let i = 0; i < 4; i++) {
    const age = i < 2 ? 40 * DAY : 1 * DAY
    const event = await db.execute(sql`
      INSERT INTO outbox_events (event_type, payload, organization_id, source_context, source_aggregate_id)
      VALUES ('test.event', '{}', 'org-ret-test', 'test', 'agg-1')
      RETURNING id
    `)
    const eventId = (event.rows[0] as { id: string }).id
    await db.execute(sql`
      INSERT INTO event_consumer_receipts (event_id, consumer_name, status, created_at)
      VALUES (${eventId}, ${'consumer-ret-' + i}, 'applied',
              ${new Date(NOW - age)})
    `)
  }
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM event_consumer_receipts`)
  await db.execute(sql`DELETE FROM outbox_events`)
  await db.execute(sql`DELETE FROM review_sync_runs`)
})

describe('retention executor (BQC-1.6)', () => {
  it('deletes only old rows in bounded batches', async () => {
    const batches: Array<[number, number]> = []
    const result = await executeRetentionRule(
      db,
      {
        subject: 'review_sync_runs',
        table: 'review_sync_runs',
        keyColumns: ['id'],
        tsColumn: 'started_at',
        olderThanMs: 30 * DAY,
      },
      {
        cutoff: new Date(NOW - 30 * DAY),
        batchSize: 2,
        onBatch: (b, c) => batches.push([b, c]),
      },
    )

    expect(result.rowsDeleted).toBe(3)
    expect(result.batches).toBe(2)
    expect(batches).toEqual([
      [1, 2],
      [2, 1],
    ])

    const remaining = await db.execute(
      sql`SELECT count(*)::int AS c FROM review_sync_runs`,
    )
    expect((remaining.rows[0] as { c: number }).c).toBe(2)
  })

  it('handles composite keys (receipts) and is safe to re-run', async () => {
    const result = await executeRetentionRule(
      db,
      {
        subject: 'event_consumer_receipts',
        table: 'event_consumer_receipts',
        keyColumns: ['event_id', 'consumer_name'],
        tsColumn: 'created_at',
        olderThanMs: 30 * DAY,
      },
      { cutoff: new Date(NOW - 30 * DAY), batchSize: 500 },
    )
    expect(result.rowsDeleted).toBe(2)

    const remaining = await db.execute(
      sql`SELECT count(*)::int AS c FROM event_consumer_receipts`,
    )
    expect((remaining.rows[0] as { c: number }).c).toBe(2)

    const rerun = await executeRetentionRule(
      db,
      {
        subject: 'event_consumer_receipts',
        table: 'event_consumer_receipts',
        keyColumns: ['event_id', 'consumer_name'],
        tsColumn: 'created_at',
        olderThanMs: 30 * DAY,
      },
      { cutoff: new Date(NOW - 30 * DAY), batchSize: 500 },
    )
    expect(rerun.rowsDeleted).toBe(0)
  })
})

// BQC-3.7 — outbox retention keys on published_at (not created_at) and the
// per-run drain is bounded by a batch cap.
describe('outbox retention — published_at keying + per-run cap (BQC-3.7)', () => {
  const OUTBOX_RULE = {
    subject: 'outbox_events.published',
    table: 'outbox_events',
    keyColumns: ['id'],
    tsColumn: 'published_at',
    olderThanMs: 30 * DAY,
    extraWhere: 'published_at IS NOT NULL',
  } as const

  async function insertOutboxRow(
    createdAt: Date,
    publishedAt: Date | null,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO outbox_events
        (event_type, payload, organization_id, source_context, source_aggregate_id, created_at, published_at)
      VALUES
        ('test.retention', '{}', 'org-ret-test', 'test', 'agg-1', ${createdAt}, ${publishedAt})
    `)
  }

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM event_consumer_receipts`)
    await db.execute(sql`DELETE FROM outbox_events`)
  })

  it('keeps an old-created but recently published event; deletes old-published ones', async () => {
    // Old create, old publish → deleted.
    await insertOutboxRow(new Date(NOW - 40 * DAY), new Date(NOW - 40 * DAY))
    // Old create, recent publish → KEPT (created_at keying would delete it).
    await insertOutboxRow(new Date(NOW - 40 * DAY), new Date(NOW - 1 * DAY))
    // Old create, never published → KEPT (extraWhere published-only).
    await insertOutboxRow(new Date(NOW - 40 * DAY), null)

    const result = await executeRetentionRule(db, OUTBOX_RULE, {
      cutoff: new Date(NOW - 30 * DAY),
      batchSize: 500,
    })

    expect(result.rowsDeleted).toBe(1)
    const remaining = await db.execute(sql`SELECT count(*)::int AS c FROM outbox_events`)
    expect((remaining.rows[0] as { c: number }).c).toBe(2)
  })

  it('stops at the per-run batch cap with rows remaining (capped)', async () => {
    for (let i = 0; i < 5; i++) {
      await insertOutboxRow(new Date(NOW - 40 * DAY), new Date(NOW - 40 * DAY + i * 1000))
    }

    const result = await executeRetentionRule(db, OUTBOX_RULE, {
      cutoff: new Date(NOW - 30 * DAY),
      batchSize: 1,
      maxBatches: 3,
    })

    expect(result.batches).toBe(3)
    expect(result.rowsDeleted).toBe(3)
    expect(result.capped).toBe(true)

    const remaining = await db.execute(sql`SELECT count(*)::int AS c FROM outbox_events`)
    expect((remaining.rows[0] as { c: number }).c).toBe(2)

    // The next scheduled run continues where this one stopped.
    const resumed = await executeRetentionRule(db, OUTBOX_RULE, {
      cutoff: new Date(NOW - 30 * DAY),
      batchSize: 1,
      maxBatches: 3,
    })
    expect(resumed.rowsDeleted).toBe(2)
    expect(resumed.capped).toBe(false)
  })
})
