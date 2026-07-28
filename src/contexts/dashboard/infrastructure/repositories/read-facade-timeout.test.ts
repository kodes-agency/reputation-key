// BQC-5.5 — the dashboard read facade's statement timeout: a read exceeding
// its budget aborts with a tagged DashboardReadTimeout error while normal
// reads pass through (real PG, SET LOCAL statement_timeout).

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { isDashboardReadTimeout, withStatementTimeout } from '../read-facade'

const db = getDb()

describe('withStatementTimeout (integration)', () => {
  it('aborts an over-budget read with a tagged timeout error', async () => {
    const err = await withStatementTimeout(db, 1, async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(0.2)`)
    }).catch((e: unknown) => e)

    expect(isDashboardReadTimeout(err)).toBe(true)
    if (isDashboardReadTimeout(err)) expect(err.budgetMs).toBe(1)
  })

  it('lets an in-budget read return its rows', async () => {
    const rows = await withStatementTimeout(db, 5000, async (tx) => {
      const result = await tx.execute(sql`SELECT 1 AS one`)
      return result.rows
    })

    expect(rows).toHaveLength(1)
  })

  it('does not leak statement_timeout to the pooled connection', async () => {
    await withStatementTimeout(db, 1, async (tx) => {
      await tx.execute(sql`SELECT 1`)
    }).catch(() => {})

    const result = await db.execute(sql`SHOW statement_timeout`)
    expect(result.rows[0]?.statement_timeout).toBe('0')
  })
})
