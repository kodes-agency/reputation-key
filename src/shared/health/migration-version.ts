// BQC-7.3 (db.migration.version) — the applied migration count as a NUMBER.
//
// Split out of readiness.ts so both the readiness probe (boolean journal
// match) and the OperationsSnapshot (numeric version) share ONE query shape
// without a readiness ↔ operations-snapshot import cycle (readiness imports
// withBudget from operations-snapshot).

import { getPool } from '#/shared/db/pool'

// drizzle.__drizzle_migrations row count — the cheap form of the 5.4
// comparator's journal query (schema-drift.ts fetchCatalog).
export const MIGRATION_COUNT_SQL =
  'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'

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
