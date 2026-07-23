// Drizzle database connection — uses node-postgres (pg) driver
// Uses the shared pool from pool.ts to avoid duplicating connections.
import { drizzle } from 'drizzle-orm/node-postgres'
import { getPool } from './pool'
import * as schema from './schema/index'

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

export function getDb() {
  if (!_db) {
    const pool = getPool()
    _db = drizzle(pool, { schema })
  }
  return _db
}

export type Database = ReturnType<typeof getDb>
