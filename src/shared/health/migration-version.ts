// BQC-7.3 (db.migration.version) — the applied migration count as a NUMBER.
//
// Split out of readiness.ts so both the readiness probe (boolean journal
// match) and the OperationsSnapshot (numeric version) share ONE query shape
// without a readiness ↔ operations-snapshot import cycle (readiness imports
// withBudget from operations-snapshot).

import { getPool } from '#/shared/db/pool'

// drizzle.__drizzle_migrations row count — the cheap form of the 5.4
// schema check's journal query (structure.server.ts).
export const MIGRATION_COUNT_SQL = `SELECT count(*)::int AS count,
    max(created_at) FILTER (WHERE (to_jsonb(m)->>'is_contract')::boolean) AS contract_when
   FROM drizzle.__drizzle_migrations m`

/**
 * The applied journal count. Returns null when the read fails — a degraded
 * snapshot reports null, never a guessed version.
 */
export async function appliedMigrationCount(): Promise<number | null> {
  try {
    const result = await getPool().query(MIGRATION_COUNT_SQL)
    const count = Number(result.rows[0]?.count)
    return Number.isFinite(count) ? count : null
  } catch {
    return null
  }
}
