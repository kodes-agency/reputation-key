// Shared helpers for repository integration tests.
// Eliminates duplicated pool wiring, truncation, and seeding across test files.
//
// B0.3: All integration tests must acquire a TestEnvironmentLease before
// creating a database pool. The lease validates NODE_ENV, opt-in flag,
// denylist, and creates a cryptographically unique marker in the database.

import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  acquireTestLease,
  validateTestDatabaseUrl,
  TestEnvironmentError,
  type TestLease,
} from './test-environment-lease'

export { validateTestDatabaseUrl, TestEnvironmentError }

export async function truncateTables(
  pool: Pool,
  tables: string[],
  orgIds: string[],
): Promise<void> {
  // WARNING: Table names are interpolated directly into SQL. This is safe
  // because callers pass hardcoded arrays from test setup. Never use this
  // pattern with user-supplied input — it is a SQL injection vector.
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds])
  }
}

export async function seedOrgs(pool: Pool, ids: string[]): Promise<void> {
  for (const id of ids) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, `Test Org ${slug}`, slug],
    )
  }
}

export function setupIntegrationDb(options: {
  orgA: OrganizationId
  orgB: OrganizationId
  tables: string[]
  maxConnections?: number
}) {
  const { orgA, orgB, tables, maxConnections = 5 } = options
  let lease: TestLease | undefined
  let pool: Pool

  beforeAll(async () => {
    const env = getEnv()
    lease = await acquireTestLease(env.DATABASE_URL, maxConnections)
    pool = lease.pool
  })

  afterAll(async () => {
    await lease?.release()
  })

  beforeEach(async () => {
    await truncateTables(pool!, tables, [orgA, orgB])
    await seedOrgs(pool!, [orgA, orgB])
  })

  return { getPool: () => pool! }
}
