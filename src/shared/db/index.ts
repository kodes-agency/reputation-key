// Drizzle database connection — uses node-postgres (pg) driver
// Uses the shared pool from pool.ts to avoid duplicating connections.
import { drizzle } from 'drizzle-orm/node-postgres'
import { getPool } from './pool'

let _db: ReturnType<typeof drizzle> | undefined

export function getDb() {
  if (!_db) {
    _db = drizzle(getPool())
  }
  return _db
}

export type Database = ReturnType<typeof getDb>

// Re-exported so db-layer and repository code can type a callback that
// must run either at the top level or inside a transaction without reaching
// into the outbox module, which owns the canonical definition because every
// outbox-commit helper already needs it.
export type { Tx } from '#/shared/outbox/commit'
