// Feed notification surface — the notification-gap read.
//
// The value of this repository is entirely in its predicate, so the predicate
// is what is asserted: the SQL captured from a fake `Database` is rendered
// through the real PostgreSQL dialect and inspected. That catches the mistakes
// that would make the gauge silently wrong — dropping the anti-join (every
// item becomes a "gap"), comparing uuid to varchar without the cast (the query
// throws at runtime, never in a unit test that only mocks the return value),
// and binding a type predicate as a parameter (the partial index behind the
// lookup no longer applies). The rule itself is proven against PostgreSQL in
// repositories/notification-gap.repository.integration.test.ts.

import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createNotificationGapRepository } from './repositories/notification-gap.repository'

const STATEMENT_TIMEOUT_MS = 2_000

const WINDOW = {
  createdAtOrAfter: new Date('2026-06-01T00:00:00.000Z'),
  createdBefore: new Date('2026-06-01T11:55:00.000Z'),
  statementTimeoutMs: STATEMENT_TIMEOUT_MS,
}

type Captured = {
  executed: SQL | null
  /** Every executed statement, in order. */
  statements: SQL[]
  /** The config of each transaction opened. */
  transactions: unknown[]
}

const fakeDb = (captured: Captured, executeRows: readonly unknown[]): Database => {
  const db = {
    execute: async (query: SQL) => {
      captured.executed = query
      captured.statements.push(query)
      return { rows: executeRows }
    },
    transaction: async (
      run: (transaction: unknown) => Promise<unknown>,
      config: unknown,
    ) => {
      captured.transactions.push(config)
      return run(db)
    },
  }
  return db as unknown as Database
}

const blank = (): Captured => ({ executed: null, statements: [], transactions: [] })

const render = (query: SQL | null): string => {
  if (query === null) throw new Error('no SQL was captured from the fake database')
  return new PgDialect().sqlToQuery(query).sql
}

describe('notification gap repository — gauge count', () => {
  it('excludes items that already have a notification row, matching on resource_id with the uuid cast', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [{ missing: 0 }]))

    await repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 })

    const sql = render(captured.executed)
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('"resource_type" = \'inbox_item\'')
    // uuid = varchar has no operator in PostgreSQL — the cast is required.
    expect(sql).toContain('"id"::text')
  })

  it("judges an item's delivery decided from its arrival fact's receipts", async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [{ missing: 0 }]))

    await repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 })

    const sql = render(captured.executed)
    expect(sql).toContain("source.event_type = 'inbox.inbox_item.created'")
    expect(sql).toContain('source.source_aggregate_id = "inbox_items"."id"::text')
    expect(sql).toContain('materialized.consumer_name = replace(')
    // Only the consumer writes 'applied'; the dispatcher's terminal gate
    // denial writes 'obsolete' under the same name without running it.
    expect(sql).toContain("base.status = 'applied'")
  })

  it('bounds the scan on both edges of the window', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, []))

    await repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 })

    const sql = render(captured.executed)
    expect(sql).toContain('"created_at" >= $1::timestamptz')
    expect(sql).toContain('"created_at" < $2::timestamptz')
  })

  it('caps the scan so the health path can never pay for an unbounded aggregate', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [{ missing: 4 }]))

    await expect(
      repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
    ).resolves.toBe(4)

    const sql = render(captured.executed)
    expect(sql).toContain('LIMIT')
    expect(sql).toContain('count(*)::int')
  })

  it('counts in a read-only transaction whose statements PostgreSQL cancels at the timeout', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [{ missing: 0 }]))

    await repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 })

    expect(captured.transactions).toEqual([{ accessMode: 'read only' }])
    const [timeout, count] = captured.statements.map((query) =>
      new PgDialect().sqlToQuery(query),
    )
    expect(timeout).toMatchObject({
      sql: "SELECT set_config('statement_timeout', $1, true)",
      params: [String(STATEMENT_TIMEOUT_MS)],
    })
    expect(count?.sql).toContain('count(*)::int')
  })

  it('refuses a statement timeout that is not a positive whole number', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, []))

    await expect(
      repo.countItemsMissingNotifications({
        ...WINDOW,
        scanLimit: 1000,
        statementTimeoutMs: 0,
      }),
    ).rejects.toThrow('statementTimeoutMs must be a positive integer')
    expect(captured.statements).toEqual([])
  })

  it('reads zero rather than NaN when the aggregate returns nothing', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, []))

    await expect(
      repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
    ).resolves.toBe(0)
  })
})
