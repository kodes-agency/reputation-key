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
//
// BQC-3.7: the per-run drain is bounded by a batch cap — one scheduled run
// deletes at most DEFAULT_MAX_BATCHES_PER_RUN batches (100 × 500 = 50k rows),
// so a huge backlog cannot stretch one run unboundedly. A capped run reports
// `capped: true`; the next scheduled run continues where this one stopped.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

/** BQC-3.7: per-run drain bound (100 batches × 500 rows = 50k rows max). */
export const DEFAULT_MAX_BATCHES_PER_RUN = 100

export type RetentionRule = Readonly<{
  /** Evidence subject, e.g. 'outbox_events.published'. */
  subject: string
  /** Table name (static registry only). */
  table: string
  /** Key columns forming the row identifier (single or composite PK). */
  keyColumns: ReadonlyArray<string>
  /** Timestamp column the cutoff applies to (ignored when equalsWhere set). */
  tsColumn: string
  /** Rows older than this are deleted (ignored when equalsWhere set). */
  olderThanMs: number
  /** Extra static predicate (e.g. 'published_at IS NOT NULL'). */
  extraWhere?: string
  /** Equality predicate for lifecycle purges (e.g. purge by connection id). */
  equalsWhere?: Readonly<{ column: string; value: string }>
}>

export type RetentionExecution = Readonly<{
  batches: number
  rowsDeleted: number
  /** True when the run stopped at the batch cap with rows (likely) remaining. */
  capped: boolean
}>

export async function executeRetentionRule(
  db: Database,
  rule: RetentionRule,
  options: {
    cutoff: Date
    batchSize?: number
    /** BQC-3.7: per-run batch cap (default DEFAULT_MAX_BATCHES_PER_RUN). */
    maxBatches?: number
    onBatch?: (batch: number, rows: number) => void
  },
): Promise<RetentionExecution> {
  const batchSize = options.batchSize ?? 500
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES_PER_RUN
  const keys = rule.keyColumns.map((k) => `"${k}"`).join(', ')
  const extra = rule.extraWhere ? `AND ${rule.extraWhere}` : ''
  // Lifecycle purge by equality (e.g. disconnect/property/org purge) or
  // age-based retention by timestamp — both from the static registry.
  const predicate = rule.equalsWhere
    ? `"${rule.equalsWhere.column}" = '${rule.equalsWhere.value}' ${extra}`
    : `"${rule.tsColumn}" < '${options.cutoff.toISOString()}' ${extra}`
  const orderColumn = rule.equalsWhere ? rule.keyColumns[0] : rule.tsColumn
  let batches = 0
  let rowsDeleted = 0
  let capped = false

  for (;;) {
    const result = await db.execute(
      sql.raw(
        `DELETE FROM "${rule.table}" WHERE (${keys}) IN (` +
          `SELECT ${keys} FROM "${rule.table}" ` +
          `WHERE ${predicate} ` +
          `ORDER BY "${orderColumn}" ASC LIMIT ${batchSize}` +
          `) RETURNING ${keys}`,
      ),
    )
    const count = result.rowCount ?? 0
    if (count === 0) break
    batches += 1
    rowsDeleted += count
    options.onBatch?.(batches, count)
    if (batches >= maxBatches) {
      // A full final batch implies more rows remain; a partial one means the
      // drain happened to finish exactly at the cap.
      capped = count === batchSize
      break
    }
  }

  return { batches, rowsDeleted, capped }
}
