import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  LEGACY_GBP_COMPATIBILITY_TABLES,
  buildLegacyGbpCompatibilitySection,
  type LegacyGbpCompatibilitySection,
  type LegacyGbpCompatibilityTableName,
} from '../application/legacy-gbp-compatibility-inventory'

type Row = Readonly<Record<string, unknown>>

const TABLE_NAMES = LEGACY_GBP_COMPATIBILITY_TABLES.map(({ tableName }) => tableName)
for (const tableName of TABLE_NAMES) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
    throw new Error('legacy_gbp_compatibility_table_name_invalid')
  }
}

const COUNT_QUERY = TABLE_NAMES.map(
  (tableName) =>
    `SELECT '${tableName}'::text AS table_name, count(*)::text AS row_count FROM public."${tableName}"`,
).join('\nUNION ALL\n')

function tableCount(row: Row): Readonly<{
  tableName: LegacyGbpCompatibilityTableName
  rowCount: number
}> {
  const tableName = String(row.table_name)
  const countText = String(row.row_count)
  if (
    !TABLE_NAMES.includes(tableName as LegacyGbpCompatibilityTableName) ||
    !/^(0|[1-9][0-9]*)$/.test(countText)
  ) {
    throw new Error('legacy_gbp_compatibility_count_invalid')
  }
  const rowCount = Number(countText)
  if (!Number.isSafeInteger(rowCount)) {
    throw new Error('legacy_gbp_compatibility_count_invalid')
  }
  return { tableName: tableName as LegacyGbpCompatibilityTableName, rowCount }
}

/**
 * One REPEATABLE READ, READ ONLY snapshot. Only `count(*)` is selected: no
 * cached provider payload, no place id, no import initiator ever leaves the
 * database through this path.
 */
export const readLegacyGbpCompatibilitySection = async (
  db: Database,
  evaluatedAt: Date,
): Promise<LegacyGbpCompatibilitySection> =>
  db.transaction(
    async (snapshot) => {
      const countResult = await snapshot.execute(sql.raw(COUNT_QUERY))
      return buildLegacyGbpCompatibilitySection({
        evaluatedAt,
        tableRows: countResult.rows.map((row) => tableCount(row as Row)),
      })
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
