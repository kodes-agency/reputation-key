// Drizzle database connection — uses node-postgres (pg) driver
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import * as schema from './schema/index'

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined
let _pool: Pool | undefined

export function getDb() {
  if (!_db) {
    const env = getEnv()
    _pool = new Pool({
      connectionString: env.DATABASE_URL_POOLER ?? env.DATABASE_URL,
      max: 10,
    })
    _db = drizzle(_pool, { schema })
  }
  return _db
}

export type Database = ReturnType<typeof getDb>

export async function isDbHealthy(): Promise<boolean> {
  try {
    const pool = _pool ?? new Pool({ connectionString: getEnv().DATABASE_URL })
    const result = await pool.query('SELECT 1')
    return result.rows.length > 0
  } catch {
    return false
  }
}
