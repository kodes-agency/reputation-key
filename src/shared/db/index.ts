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
