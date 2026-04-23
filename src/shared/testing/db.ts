// Test database helpers — for integration tests against real Postgres.
// Per architecture: "Neon branch per integration test suite, or local Docker Postgres in CI."
// For now: connects using DATABASE_URL directly. Neon branching can be added later.

import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import type { Database } from '#/shared/db'
import type { OrganizationId } from '#/shared/domain/ids'

export type TestDb = Readonly<{
  /** Drizzle client for typed queries */
  db: Database
  /** Raw pg Pool for direct SQL (truncation, etc.) */
  pool: Pool
  /** Truncate all tables (except better-auth managed tables) */
  truncateAll: () => Promise<void>
  /** Seed organization records needed for FK constraints (raw SQL) */
  seedOrganizations: (ids: ReadonlyArray<OrganizationId>) => Promise<void>
  /** Close the pool and clean up */
  close: () => Promise<void>
}>

export async function setupTestDatabase(): Promise<TestDb> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set for integration tests')
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
  })

  const db = getDb()

  return {
    db,
    pool,
    async truncateAll(): Promise<void> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { rows } = await client.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
          AND tablename NOT LIKE 'pg_%'
          ORDER BY tablename
        `)
        for (const row of rows) {
          await client.query(`TRUNCATE TABLE "${row.tablename}" CASCADE`)
        }
        await client.query('COMMIT')
      } catch {
        await client.query('ROLLBACK')
        throw new Error('Failed to truncate test database')
      } finally {
        client.release()
      }
    },

    async seedOrganizations(ids: ReadonlyArray<OrganizationId>): Promise<void> {
      // better-auth owns the organization table, so we use raw SQL
      for (const id of ids) {
        await pool.query(
          `INSERT INTO organization (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [id, `Test Org ${id.substring(0, 8)}`, `test-org-${id.substring(0, 8)}`],
        )
      }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}

export async function teardownTestDatabase(testDb: TestDb): Promise<void> {
  await testDb.close()
}
