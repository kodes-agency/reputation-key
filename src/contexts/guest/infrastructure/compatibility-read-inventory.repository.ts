import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  COMPATIBILITY_READ_TABLES,
  buildCompatibilityReadInventoryReport,
  type CompatibilityReadForeignKey,
  type CompatibilityReadInventoryReport,
  type CompatibilityReadReferentialAction,
  type CompatibilityReadTableName,
} from '../application/compatibility-read-inventory'

type Row = Readonly<Record<string, unknown>>

const TABLE_NAMES = COMPATIBILITY_READ_TABLES.map(({ tableName }) => tableName)
for (const tableName of TABLE_NAMES) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
    throw new Error('compatibility_read_inventory_table_name_invalid')
  }
}

const COUNT_QUERY = TABLE_NAMES.map(
  (tableName) =>
    `SELECT '${tableName}'::text AS table_name, count(*)::text AS row_count FROM public."${tableName}"`,
).join('\nUNION ALL\n')

const TABLE_NAME_LIST = TABLE_NAMES.map((tableName) => `'${tableName}'`).join(', ')

const FOREIGN_KEY_QUERY = `
SELECT constraint_row.conname::text AS constraint_name,
       source_namespace.nspname::text AS source_schema,
       source_table.relname::text AS source_table,
       ARRAY(
         SELECT source_attribute.attname::text
         FROM unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, position)
         JOIN pg_attribute AS source_attribute
           ON source_attribute.attrelid = constraint_row.conrelid
          AND source_attribute.attnum = source_key.attnum
         ORDER BY source_key.position
       ) AS source_columns,
       target_namespace.nspname::text AS target_schema,
       target_table.relname::text AS target_table,
       ARRAY(
         SELECT target_attribute.attname::text
         FROM unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, position)
         JOIN pg_attribute AS target_attribute
           ON target_attribute.attrelid = constraint_row.confrelid
          AND target_attribute.attnum = target_key.attnum
         ORDER BY target_key.position
       ) AS target_columns,
       constraint_row.confdeltype::text AS delete_action,
       CASE
         WHEN constraint_row.confdelsetcols IS NULL THEN NULL
         ELSE ARRAY(
           SELECT source_attribute.attname::text
           FROM unnest(constraint_row.confdelsetcols)
             WITH ORDINALITY AS delete_set_key(attnum, position)
           JOIN pg_attribute AS source_attribute
             ON source_attribute.attrelid = constraint_row.conrelid
            AND source_attribute.attnum = delete_set_key.attnum
           ORDER BY delete_set_key.position
         )
       END AS delete_action_columns,
       constraint_row.confupdtype::text AS update_action,
       constraint_row.confmatchtype::text AS match_type,
       constraint_row.condeferrable AS deferrable,
       constraint_row.condeferred AS initially_deferred,
       constraint_row.convalidated AS validated
FROM pg_constraint AS constraint_row
JOIN pg_class AS source_table ON source_table.oid = constraint_row.conrelid
JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_table.relnamespace
JOIN pg_class AS target_table ON target_table.oid = constraint_row.confrelid
JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
WHERE constraint_row.contype = 'f'
  AND (
    (source_namespace.nspname = 'public' AND source_table.relname IN (${TABLE_NAME_LIST}))
    OR
    (target_namespace.nspname = 'public' AND target_table.relname IN (${TABLE_NAME_LIST}))
  )
ORDER BY source_namespace.nspname,
         source_table.relname,
         target_namespace.nspname,
         target_table.relname,
         constraint_row.conname
`

function tableCount(row: Row): Readonly<{
  tableName: CompatibilityReadTableName
  rowCount: number
}> {
  const tableName = String(row.table_name)
  const countText = String(row.row_count)
  if (
    !TABLE_NAMES.includes(tableName as CompatibilityReadTableName) ||
    !/^(0|[1-9][0-9]*)$/.test(countText)
  ) {
    throw new Error('compatibility_read_inventory_count_invalid')
  }
  const rowCount = Number(countText)
  if (!Number.isSafeInteger(rowCount)) {
    throw new Error('compatibility_read_inventory_count_invalid')
  }
  return { tableName: tableName as CompatibilityReadTableName, rowCount }
}

const REFERENTIAL_ACTIONS: Readonly<
  Record<'a' | 'r' | 'c' | 'n' | 'd', CompatibilityReadReferentialAction>
> = Object.freeze({
  a: 'no_action',
  r: 'restrict',
  c: 'cascade',
  n: 'set_null',
  d: 'set_default',
})

const MATCH_TYPES = Object.freeze({ s: 'simple', f: 'full', p: 'partial' } as const)

function foreignKey(row: Row): CompatibilityReadForeignKey {
  const constraintName = row.constraint_name
  const sourceSchema = row.source_schema
  const sourceTable = row.source_table
  const sourceColumns = row.source_columns
  const targetSchema = row.target_schema
  const targetTable = row.target_table
  const targetColumns = row.target_columns
  const deleteAction = String(row.delete_action) as keyof typeof REFERENTIAL_ACTIONS
  const deleteActionColumns = row.delete_action_columns
  const updateAction = String(row.update_action) as keyof typeof REFERENTIAL_ACTIONS
  const matchType = String(row.match_type) as keyof typeof MATCH_TYPES
  if (
    typeof constraintName !== 'string' ||
    typeof sourceSchema !== 'string' ||
    typeof sourceTable !== 'string' ||
    !Array.isArray(sourceColumns) ||
    sourceColumns.some((column) => typeof column !== 'string') ||
    typeof targetSchema !== 'string' ||
    typeof targetTable !== 'string' ||
    !Array.isArray(targetColumns) ||
    targetColumns.some((column) => typeof column !== 'string') ||
    !(deleteAction in REFERENTIAL_ACTIONS) ||
    !(
      deleteActionColumns === null ||
      (Array.isArray(deleteActionColumns) &&
        deleteActionColumns.every((column) => typeof column === 'string'))
    ) ||
    !(updateAction in REFERENTIAL_ACTIONS) ||
    !(matchType in MATCH_TYPES) ||
    typeof row.deferrable !== 'boolean' ||
    typeof row.initially_deferred !== 'boolean' ||
    typeof row.validated !== 'boolean'
  ) {
    throw new Error('compatibility_read_inventory_foreign_key_invalid')
  }
  return {
    constraintName,
    sourceSchema,
    sourceTable,
    sourceColumns: sourceColumns as string[],
    targetSchema,
    targetTable,
    targetColumns: targetColumns as string[],
    onDelete: REFERENTIAL_ACTIONS[deleteAction],
    onDeleteSetColumns: deleteActionColumns as string[] | null,
    onUpdate: REFERENTIAL_ACTIONS[updateAction],
    matchType: MATCH_TYPES[matchType],
    deferrable: row.deferrable,
    initiallyDeferred: row.initially_deferred,
    validated: row.validated,
  }
}

/**
 * One REPEATABLE READ, READ ONLY snapshot so the counts and the constraint
 * metadata describe the same instant.
 *
 * Only `count(*)` and `pg_constraint`/`pg_attribute` metadata are selected.
 * No guest column is ever named: not a rating value, not feedback text, not a
 * scan session identifier. That is what makes the artifact attachable to a
 * review record.
 */
export const readCompatibilityReadInventory = async (
  db: Database,
  evaluatedAt: Date,
): Promise<CompatibilityReadInventoryReport> =>
  db.transaction(
    async (snapshot) => {
      const countResult = await snapshot.execute(sql.raw(COUNT_QUERY))
      const foreignKeyResult = await snapshot.execute(sql.raw(FOREIGN_KEY_QUERY))
      return buildCompatibilityReadInventoryReport({
        evaluatedAt,
        tableRows: countResult.rows.map((row) => tableCount(row as Row)),
        foreignKeys: foreignKeyResult.rows.map((row) => foreignKey(row as Row)),
      })
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
