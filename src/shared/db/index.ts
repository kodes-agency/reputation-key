// Drizzle database connection — uses node-postgres (pg) driver
// Uses the shared pool from pool.ts to avoid duplicating connections.
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { getPool } from './pool'
import { getExecutionDeadline } from './execution-deadline.server'

let _db: ReturnType<typeof drizzle> | undefined

/** Build a database whose job transactions inherit the dispatch deadline. */
export function createDatabase(pool: Pool): ReturnType<typeof drizzle> {
  const db = drizzle(pool)
  const transaction = db.transaction.bind(db)
  db.transaction = async (work, config) => {
    const deadline = getExecutionDeadline()
    deadline?.signal.throwIfAborted()
    return transaction(async (tx) => {
      if (deadline) {
        deadline.signal.throwIfAborted()
        // LOCAL resets on commit/rollback, including pooled reuse. Never
        // pass zero: PostgreSQL interprets it as an unlimited statement.
        const remainingMs = Math.max(1, deadline.expiresAt - Date.now())
        await tx.execute(
          sql`select set_config('statement_timeout', ${String(remainingMs)}, true)`,
        )
        deadline.signal.throwIfAborted()
      }
      const result = await work(tx)
      deadline?.signal.throwIfAborted()
      return result
    }, config)
  }
  return db
}

export function getDb() {
  _db ??= createDatabase(getPool())
  return _db
}

export type Database = ReturnType<typeof getDb>

// Re-exported so db-layer and repository code can type a callback that
// must run either at the top level or inside a transaction without reaching
// into the outbox module, which owns the canonical definition because every
// outbox-commit helper already needs it.
export type { Tx } from '#/shared/outbox/commit'
