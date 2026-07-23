// DB liveness probe — lives in shared/health (not shared/db) so health routes
// can probe liveness without importing the shared/db schema barrel (BQC-5.1:
// routes and context server layers must not depend on shared/db).
import { getPool } from '#/shared/db/pool'
import { getLogger } from '#/shared/observability/logger'

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
