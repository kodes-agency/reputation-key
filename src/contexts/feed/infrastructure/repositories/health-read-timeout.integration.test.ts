// The notification health reads' statement timeout against real PostgreSQL.
// The operations snapshot stops waiting for a health signal at its per-signal
// cap; the database must give up on a stalled statement no later, or the query
// outlives the caller that asked for it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { OPS_HEALTH_SIGNAL_BUDGET_MS } from '#/shared/health/operations-snapshot'
import {
  NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS,
  NotificationHealthReadTimeoutError,
  withHealthReadTimeout,
} from './health-read-timeout'

const SHORT_TIMEOUT_MS = 250

describe('notification health read statement timeout (real PostgreSQL)', () => {
  let pool: Pool
  let db: Database

  beforeAll(() => {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
    db = drizzle(pool) as unknown as Database
  })

  afterAll(async () => {
    await pool?.end()
  })

  const setting = async (read: Database, name: string): Promise<string> => {
    const result = await read.execute(sql`SELECT current_setting(${name}) AS value`)
    return String((result.rows[0] as { value: string }).value)
  }

  it('cancels a stalled statement before the operations snapshot stops waiting for it', () => {
    expect(NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS).toBeLessThan(
      OPS_HEALTH_SIGNAL_BUDGET_MS,
    )
  })

  it('names the statement timeout as the read’s failure when PostgreSQL cancels a stalled statement', async () => {
    const started = Date.now()

    await expect(
      withHealthReadTimeout(db, SHORT_TIMEOUT_MS, (tx) =>
        tx.execute(sql`SELECT pg_sleep(5)`),
      ),
    ).rejects.toBeInstanceOf(NotificationHealthReadTimeoutError)

    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('passes every other database failure through unchanged', async () => {
    const failure = await withHealthReadTimeout(db, SHORT_TIMEOUT_MS, (tx) =>
      tx.execute(sql`SELECT 1 / 0`),
    ).catch((error: unknown) => error)

    expect(failure).not.toBeInstanceOf(NotificationHealthReadTimeoutError)
    expect(failure).toBeInstanceOf(Error)
  })

  // A health read is a short OLTP statement. PostgreSQL's JIT compile cost
  // (0.7-0.9 s) once dominated the delivery-lag source read after a bulk import
  // pushed its cost estimate over the JIT threshold, so it is switched off for
  // the read's transaction only.
  it('turns JIT off and sets the timeout for the read, and neither outlives its transaction', async () => {
    const duringRead = await withHealthReadTimeout(db, SHORT_TIMEOUT_MS, async (tx) => ({
      timeout: await setting(tx as unknown as Database, 'statement_timeout'),
      jit: await setting(tx as unknown as Database, 'jit'),
    }))

    expect(duringRead).toEqual({ timeout: '250ms', jit: 'off' })
    expect(await setting(db, 'statement_timeout')).not.toBe('250ms')
  })

  it('reads in a read-only transaction', async () => {
    const write = withHealthReadTimeout(db, SHORT_TIMEOUT_MS, (tx) =>
      tx.execute(sql`CREATE TEMP TABLE health_read_probe (id int)`),
    )

    await expect(write).rejects.toMatchObject({
      cause: { code: '25006' },
    })
  })

  it('refuses a timeout that is not a positive whole number of milliseconds', async () => {
    await expect(withHealthReadTimeout(db, 0, async () => 1)).rejects.toThrow(
      /positive integer/,
    )
    await expect(withHealthReadTimeout(db, 1.5, async () => 1)).rejects.toThrow(
      /positive integer/,
    )
  })
})
