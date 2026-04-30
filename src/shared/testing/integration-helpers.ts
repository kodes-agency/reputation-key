// Shared helpers for repository integration tests.
// Eliminates duplicated pool wiring, truncation, and seeding across test files.

import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { OrganizationId } from '#/shared/domain/ids'

export function createTestPool(maxConnections = 5): Pool {
  const env = getEnv()
  return new Pool({ connectionString: env.DATABASE_URL, max: maxConnections })
}

export async function truncateTables(
  pool: Pool,
  tables: string[],
  orgIds: string[],
): Promise<void> {
  for (const table of tables) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id = ANY($1)`,
      [orgIds],
    )
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
  let pool: Pool

  beforeAll(async () => {
    pool = createTestPool(maxConnections)
    const client = await pool.connect()
    client.release()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await truncateTables(pool, tables, [orgA, orgB])
    await seedOrgs(pool, [orgA, orgB])
  })

  return { getPool: () => pool }
}
