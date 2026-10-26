// Feed notification surface — the order of the delivery-lag source read.
//
// The source read counts the facts a notification route has no receipt for,
// minus those that announce nothing (silent-route-fact.ts). A bulk import
// puts thousands of silent facts in the 24 h window while only a few lack a
// receipt, so the read must find the unreceipted facts first and test only
// those for silence: testing every window row ran two hashed subplans over
// inbox tables for 5.5k rows to count 28. What the read returns is pinned
// against PostgreSQL in repositories/notification-delivery-lag-silent-facts
// .test.ts; this pins the shape that keeps it cheap, from the SQL a fake
// `Database` captures, rendered through the real PostgreSQL dialect.

import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { createNotificationDeliveryLagRepository } from './repositories/notification-delivery-lag.repository'

const WINDOW = {
  recordedAtOrAfter: new Date('2026-10-25T00:00:00.000Z'),
  recordedBefore: new Date('2026-10-26T00:00:00.000Z'),
  scanLimit: 1000,
  statementTimeoutMs: 2_000,
}

/** The statements one read runs, rendered as PostgreSQL would receive them. */
const statementsOfOneRead = async (): Promise<string[]> => {
  const statements: SQL[] = []
  const db = {
    execute: async (query: SQL) => {
      statements.push(query)
      return { rows: [] }
    },
    transaction: async (run: (transaction: unknown) => Promise<unknown>) => run(db),
  }

  await createNotificationDeliveryLagRepository(
    db as unknown as Database,
    () => true,
  ).read(WINDOW)

  return statements.map((query) => new PgDialect().sqlToQuery(query).sql)
}

describe('delivery-lag source read', () => {
  it('finds the unreceipted facts first, then tests only those for silence', async () => {
    const statements = await statementsOfOneRead()

    const sourceRead = statements.find((statement) =>
      statement.includes('AS "eventType"'),
    )
    expect(sourceRead).toBeDefined()
    const receiptAntiJoin = sourceRead!.indexOf('"event_consumer_receipts"')
    const silentTestInput = sourceRead!.indexOf('FROM unreceipted AS event')
    const firstSilentLookup = sourceRead!.indexOf('"inbox_items"')
    // The anti-join is materialized, so the silent test cannot be pushed back
    // into the outbox scan.
    expect(sourceRead).toContain('unreceipted AS MATERIALIZED')
    expect(receiptAntiJoin).toBeGreaterThan(-1)
    expect(silentTestInput).toBeGreaterThan(receiptAntiJoin)
    expect(firstSilentLookup).toBeGreaterThan(silentTestInput)
  })
})
