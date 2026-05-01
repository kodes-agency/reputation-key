// Drizzle database connection — uses node-postgres (pg) driver
// Uses the shared pool from pool.ts to avoid duplicating connections.
import { drizzle } from 'drizzle-orm/node-postgres'
import { getPool } from './pool'
import { getLogger } from '#/shared/observability/logger'
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

/**
 * Health check uses raw SQL (not Drizzle) because Drizzle's query builder
 * doesn't provide a lightweight "ping" API. SELECT 1 via the shared pool
 * is the standard Postgres liveness check.
 */
export async function isDbHealthy(): Promise<boolean> {
  try {
    const pool = getPool()
    const result = await pool.query('SELECT 1')
    return result.rows.length > 0
  } catch (err) {
    getLogger().warn({ err }, '[db] health check failed')
    return false
  }
}
