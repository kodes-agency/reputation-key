// Shared database pool — single connection pool for both Drizzle and Better Auth.
// Per Issue 6: Auth and Drizzle each created their own Pool, doubling connections.
// This module provides a single Pool shared across the application.

import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

let _pool: Pool | undefined

/** Get the shared database connection pool. Creates it on first call. */
export function getPool(): Pool {
  if (!_pool) {
    const env = getEnv()
    _pool = new Pool({
      connectionString: env.DATABASE_URL_POOLER ?? env.DATABASE_URL,
      max: 10,
    })
  }
  return _pool
}

/** Close the shared pool. Call during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = undefined
  }
}
