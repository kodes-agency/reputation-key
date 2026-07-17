// Retention executor — BQC-1.6: valid PostgreSQL bounded batch deletion.
//
// Replaces the invalid `DELETE ... LIMIT` pattern (syntax error in
// PostgreSQL) with the documented id-IN-subquery pattern:
//
//   DELETE FROM t WHERE (key...) IN (
//     SELECT key... FROM t WHERE <ts> < cutoff [AND extra]
//     ORDER BY <ts> ASC LIMIT n
//   ) RETURNING key...
//
// Loop until empty — each batch is atomic; re-running is safe. Identifiers
// come only from the static rule registry (never user input).

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type RetentionRule = Readonly<{
  /** Evidence subject, e.g. 'outbox_events.published'. */
  subject: string
  /** Table name (static registry only). */
  table: string
  /** Key columns forming the row identifier (single or composite PK). */
  keyColumns: ReadonlyArray<string>
  /** Timestamp column the cutoff applies to. */
  tsColumn: string
  /** Rows older than this are deleted. */
  olderThanMs: number
  /** Extra static predicate (e.g. 'published_at IS NOT NULL'). */
  extraWhere?: string
}>

export type RetentionExecution = Readonly<{
  batches: number
  rowsDeleted: number
}>

export async function executeRetentionRule(
  db: Database,
  rule: RetentionRule,
  options: {
    cutoff: Date
    batchSize?: number
    onBatch?: (batch: number, rows: number) => void
  },
): Promise<RetentionExecution> {
  const batchSize = options.batchSize ?? 500
  const keys = rule.keyColumns.map((k) => `"${k}"`).join(', ')
  const extra = rule.extraWhere ? `AND ${rule.extraWhere}` : ''
  let batches = 0
  let rowsDeleted = 0

  for (;;) {
    const result = await db.execute(
      sql.raw(
        `DELETE FROM "${rule.table}" WHERE (${keys}) IN (` +
          `SELECT ${keys} FROM "${rule.table}" ` +
          `WHERE "${rule.tsColumn}" < '${options.cutoff.toISOString()}' ${extra} ` +
          `ORDER BY "${rule.tsColumn}" ASC LIMIT ${batchSize}` +
          `) RETURNING ${keys}`,
      ),
    )
    const count = result.rowCount ?? 0
    if (count === 0) break
    batches += 1
    rowsDeleted += count
    options.onBatch?.(batches, count)
  }

  return { batches, rowsDeleted }
}
