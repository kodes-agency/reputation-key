// Fixture-teardown escape hatch for the last-owner backstop (BQC-5.4).
//
// The registered deploy sidecar (scripts/migrations/2026-07-06-permission-version-triggers.sql)
// installs the member_last_owner_del / member_last_owner_upd triggers, which
// block deleting an org's final owner row — including fixture teardown that
// wipes member/organization rows (FK cascades from organization fire row
// triggers too). Test cleanup therefore disables ONLY those two guard
// triggers inside its transaction (ALTER TABLE ... DISABLE TRIGGER is
// transactional in PostgreSQL, so a rollback restores them automatically).
//
// Deliberately NOT session_replication_role='replica': that also suppresses
// the system triggers implementing FK cascades, silently orphaning child
// rows across runs. Cascades keep working here.
//
// Requires ownership of member (CI's `test` user and local dev Postgres both
// have it); integration tests are the only consumers.

import { sql, type SQL } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import type { Database } from '#/shared/db'

const DISABLE_GUARDS = [
  sql`ALTER TABLE member DISABLE TRIGGER member_last_owner_del`,
  sql`ALTER TABLE member DISABLE TRIGGER member_last_owner_upd`,
]
const ENABLE_GUARDS = [
  sql`ALTER TABLE member ENABLE TRIGGER member_last_owner_del`,
  sql`ALTER TABLE member ENABLE TRIGGER member_last_owner_upd`,
]

/**
 * Run SQL statements in a single transaction with the last-owner guard
 * triggers disabled (re-enabled before commit). For drizzle `db` handles.
 */
export async function executeWithLastOwnerGuardDisabled(
  db: Database,
  statements: readonly SQL[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const statement of DISABLE_GUARDS) await tx.execute(statement)
    try {
      for (const statement of statements) await tx.execute(statement)
    } finally {
      for (const statement of ENABLE_GUARDS) await tx.execute(statement)
    }
  })
}

/**
 * Run fn(client) in a single transaction with the last-owner guard triggers
 * disabled (re-enabled before commit). For raw pg Pool handles.
 */
export async function withLastOwnerGuardDisabled<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('ALTER TABLE member DISABLE TRIGGER member_last_owner_del')
    await client.query('ALTER TABLE member DISABLE TRIGGER member_last_owner_upd')
    try {
      const result = await fn(client)
      await client.query('ALTER TABLE member ENABLE TRIGGER member_last_owner_del')
      await client.query('ALTER TABLE member ENABLE TRIGGER member_last_owner_upd')
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    client.release()
  }
}
