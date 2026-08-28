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
// Loop until empty — each batch is atomic; re-running is safe. Identifiers and
// extraWhere fragments come only from the static rule registry; every runtime
// value is bound through Drizzle's parameter path.
//
// BQC-3.7: the per-run drain is bounded by a batch cap — one scheduled run
// deletes at most DEFAULT_MAX_BATCHES_PER_RUN batches (100 × 500 = 50k rows),
// so a huge backlog cannot stretch one run unboundedly. A capped run reports
// `capped: true`; the next scheduled run continues where this one stopped.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'

/** BQC-3.7: per-run drain bound (100 batches × 500 rows = 50k rows max). */
export const DEFAULT_MAX_BATCHES_PER_RUN = 100

type RetentionRuleBase = Readonly<{
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
  /** Extra runtime-free registry predicate (e.g. 'published_at IS NOT NULL'). */
  extraWhere?: string
  /** Bound equality predicates for lifecycle purges and tenant scoping. */
  equalsWhere?: ReadonlyArray<Readonly<{ column: string; value: string }>>
}>

export type RetentionRule = RetentionRuleBase &
  (
    | Readonly<{
        operation?: 'delete'
        redactColumns?: never
      }>
    | Readonly<{
        operation: 'redact'
        /** Static registry columns set to NULL while retaining the business row. */
        redactColumns: ReadonlyArray<string>
      }>
  )

export type RetentionExecution = Readonly<{
  batches: number
  rowsDeleted: number
  rowsRedacted: number
  /** True when the run stopped at the batch cap with rows (likely) remaining. */
  capped: boolean
}>

function retentionPredicate(rule: RetentionRule, cutoff: Date): SQL {
  if (rule.equalsWhere?.length === 0) {
    throw new Error(`Retention rule '${rule.subject}' has an empty equality scope`)
  }
  const conditions: SQL[] = rule.equalsWhere
    ? rule.equalsWhere.map(
        ({ column, value }) => sql`${sql.identifier(column)} = ${value}`,
      )
    : [sql`${sql.identifier(rule.tsColumn)} < ${cutoff}`]
  if (rule.extraWhere) conditions.push(sql.raw(rule.extraWhere))
  return sql.join(conditions, sql` AND `)
}

/**
 * Content-free eligibility count used by isolated restore verification. The
 * caller must pass a rule from the static retention registry; identifiers and
 * predicates are deliberately not a public/user-input query surface.
 */
export async function countRetentionRuleCandidates(
  db: Database,
  rule: RetentionRule,
  cutoff: Date,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM ${sql.identifier(rule.table)} WHERE ${retentionPredicate(rule, cutoff)}`,
  )
  return Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0)
}

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
  const keys = sql.join(
    rule.keyColumns.map((column) => sql.identifier(column)),
    sql`, `,
  )
  const table = sql.identifier(rule.table)
  // Lifecycle purge by equality (e.g. disconnect/property/org purge) or
  // age-based retention by timestamp — both from the static registry.
  const predicate = retentionPredicate(rule, options.cutoff)
  const orderColumn = rule.equalsWhere ? rule.keyColumns[0] : rule.tsColumn
  let batches = 0
  let rowsDeleted = 0
  let rowsRedacted = 0
  let capped = false

  for (;;) {
    const candidates = sql`SELECT ${keys} FROM ${table} WHERE ${predicate} ORDER BY ${sql.identifier(orderColumn)} ASC LIMIT ${batchSize}`
    const statement =
      rule.operation === 'redact'
        ? sql`UPDATE ${table} SET ${sql.join(
            rule.redactColumns.map((column) => sql`${sql.identifier(column)} = NULL`),
            sql`, `,
          )} WHERE (${keys}) IN (${candidates}) AND ${predicate} RETURNING ${keys}`
        : sql`DELETE FROM ${table} WHERE (${keys}) IN (${candidates}) RETURNING ${keys}`
    const result = await db.execute(statement)
    const count = result.rowCount ?? 0
    if (count === 0) break
    batches += 1
    if (rule.operation === 'redact') rowsRedacted += count
    else rowsDeleted += count
    options.onBatch?.(batches, count)
    if (batches >= maxBatches) {
      // A full final batch implies more rows remain; a partial one means the
      // drain happened to finish exactly at the cap.
      capped = count === batchSize
      break
    }
  }

  return { batches, rowsDeleted, rowsRedacted, capped }
}
