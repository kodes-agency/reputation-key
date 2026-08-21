// Notification context — the notification-gap read.
//
// The value of this repository is entirely in its predicate, so the predicate
// is what is asserted: the SQL captured from a fake `Database` is rendered
// through the real PostgreSQL dialect and inspected. That catches the two
// mistakes that would make the sweep silently wrong — dropping the anti-join
// (every item becomes a "gap" and every new review gets a duplicate
// notification) and comparing uuid to varchar without the cast (the query
// throws at runtime, never in a unit test that only mocks the return value).

import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createNotificationGapRepository } from './repositories/notification-gap.repository'

const WINDOW = {
  createdAtOrAfter: new Date('2026-06-01T00:00:00.000Z'),
  createdBefore: new Date('2026-06-01T11:55:00.000Z'),
}

const ROW = {
  inboxItemId: '11111111-1111-4111-8111-111111111111',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  sourceType: 'review',
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
}

type Captured = {
  where: SQL | null
  orderBy: readonly unknown[]
  limit: number | null
  executed: SQL | null
}

const fakeDb = (
  captured: Captured,
  rows: readonly unknown[],
  executeRows: readonly unknown[],
): Database =>
  ({
    select: () => ({
      from: () => ({
        where: (where: SQL) => {
          captured.where = where
          return {
            orderBy: (...columns: unknown[]) => {
              captured.orderBy = columns
              return {
                limit: async (limit: number) => {
                  captured.limit = limit
                  return rows
                },
              }
            },
          }
        },
      }),
    }),
    execute: async (query: SQL) => {
      captured.executed = query
      return { rows: executeRows }
    },
  }) as unknown as Database

const blank = (): Captured => ({
  where: null,
  orderBy: [],
  limit: null,
  executed: null,
})

const render = (query: SQL | null): string => {
  if (query === null) throw new Error('no SQL was captured from the fake database')
  return new PgDialect().sqlToQuery(query).sql
}

describe('notification gap repository — candidate batches', () => {
  it('excludes items that already have a notification row, matching on resource_id with the uuid cast', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [ROW], []))

    await repo.findItemsMissingNotifications({ ...WINDOW, cursor: null, limit: 100 })

    const sql = render(captured.where)
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('"resource_type" = \'inbox_item\'')
    // uuid = varchar has no operator in PostgreSQL — the cast is required.
    expect(sql).toContain('"id"::text')
  })

  it('bounds the scan on both edges of the window', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [], []))

    await repo.findItemsMissingNotifications({ ...WINDOW, cursor: null, limit: 100 })

    const sql = render(captured.where)
    expect(sql).toContain('"created_at" >= $1::timestamptz')
    expect(sql).toContain('"created_at" < $2::timestamptz')
  })

  it('adds a row-wise keyset predicate only when resuming from a cursor', async () => {
    const first = blank()
    const repo = createNotificationGapRepository(fakeDb(first, [], []))
    await repo.findItemsMissingNotifications({ ...WINDOW, cursor: null, limit: 100 })
    expect(render(first.where)).not.toContain('>  (')

    const resumed = blank()
    const resumedRepo = createNotificationGapRepository(fakeDb(resumed, [], []))
    await resumedRepo.findItemsMissingNotifications({
      ...WINDOW,
      cursor: { createdAt: ROW.createdAt, inboxItemId: ROW.inboxItemId },
      limit: 100,
    })

    const sql = render(resumed.where)
    // (created_at, id) > ($n::timestamptz, $m::uuid) — one comparison, so a
    // batch boundary can never skip or repeat a row.
    expect(sql).toMatch(/\("inbox_items"\."created_at", "inbox_items"\."id"\) >/)
    expect(sql).toContain('::uuid')
  })

  it('orders by the keyset columns and honours the batch limit', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [ROW], []))

    const rows = await repo.findItemsMissingNotifications({
      ...WINDOW,
      cursor: null,
      limit: 37,
    })

    expect(captured.limit).toBe(37)
    expect(captured.orderBy).toHaveLength(2)
    expect(rows).toEqual([ROW])
  })
})

describe('notification gap repository — gauge count', () => {
  it('caps the scan so the health path can never pay for an unbounded aggregate', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [], [{ missing: 4 }]))

    await expect(
      repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
    ).resolves.toBe(4)

    const sql = render(captured.executed)
    expect(sql).toContain('LIMIT')
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('count(*)::int')
  })

  it('reads zero rather than NaN when the aggregate returns nothing', async () => {
    const captured = blank()
    const repo = createNotificationGapRepository(fakeDb(captured, [], []))

    await expect(
      repo.countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
    ).resolves.toBe(0)
  })
})
