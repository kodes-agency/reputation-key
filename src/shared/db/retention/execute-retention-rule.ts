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
  /** Extra runtime-free registry predicate (e.g. 'published_at IS NOT NULL'). */
  extraWhere?: string
  /** Bound equality predicates for lifecycle purges and tenant scoping. */
  equalsWhere?: ReadonlyArray<Readonly<{ column: string; value: string }>>
  /**
   * Rows that reference a deleted row through a restricting foreign key and go
   * with it. Each batch deletes them and their parents in one transaction, so a
   * stop between the two leaves no parent without its dependents' removal and no
   * dependent removed alone. The rule must have a single key column.
   */
  dependents?: ReadonlyArray<RetentionDependent>
}>

export type RetentionDependent = Readonly<{
  table: string
  /** Column holding the parent's key. */
  referenceColumn: string
  /** Dependent's own key, needed with selfReferenceColumn. */
  keyColumn: string
  /** Column by which a dependent points at another dependent; leaves go first. */
  selfReferenceColumn?: string
}>

/**
 * How old a row must be before the rule reaches it (ignored when equalsWhere
 * set). A rule states one of the two, and `retentionRuleCutoff` is the only
 * place that turns either into a cutoff. A rule stated in months has no
 * `olderThanMs`, so no caller can derive its cutoff by subtracting one: with a
 * zero there, that sum would be "now" and the rule would reach every row.
 */
export type RetentionRuleAge =
  | Readonly<{
      /** A fixed age; 0 when tsColumn already holds the row's deadline. */
      olderThanMs: number
      olderThanMonths?: never
    }>
  | Readonly<{
      /** UTC calendar months, for a horizon that is published in months. */
      olderThanMonths: number
      olderThanMs?: never
    }>

export type RetentionRule = RetentionRuleBase &
  RetentionRuleAge &
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

const keyCount = (rule: RetentionRule): number => rule.keyColumns.length

/**
 * One batch: lock the due parents, delete their dependents (leaves first when
 * dependents point at each other), then the parents, in one transaction. A
 * dependent created meanwhile makes the parent delete fail and roll back.
 */
async function deleteWithDependents(
  db: Database,
  rule: RetentionRule,
  dependents: ReadonlyArray<RetentionDependent>,
  candidates: SQL,
  predicate: SQL,
): Promise<number> {
  const keyColumn = sql.identifier(rule.keyColumns[0] ?? '')
  const table = sql.identifier(rule.table)
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`${candidates} FOR UPDATE`)
    const ids = (locked.rows as ReadonlyArray<Record<string, unknown>>).map(
      (row) => row[rule.keyColumns[0] ?? ''],
    )
    if (ids.length === 0) return 0
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )
    for (const dependent of dependents) {
      const dependentTable = sql.identifier(dependent.table)
      const reference = sql.identifier(dependent.referenceColumn)
      if (!dependent.selfReferenceColumn) {
        await tx.execute(
          sql`DELETE FROM ${dependentTable} WHERE ${reference} IN (${idList})`,
        )
        continue
      }
      const key = sql.identifier(dependent.keyColumn)
      const self = sql.identifier(dependent.selfReferenceColumn)
      for (;;) {
        const removed = await tx.execute(
          sql`DELETE FROM ${dependentTable} AS d WHERE d.${reference} IN (${idList}) AND NOT EXISTS (SELECT 1 FROM ${dependentTable} AS s WHERE s.${self} = d.${key})`,
        )
        if ((removed.rowCount ?? 0) === 0) break
      }
    }
    const deleted = await tx.execute(
      sql`DELETE FROM ${table} WHERE ${keyColumn} IN (${idList}) AND ${predicate} RETURNING ${keyColumn}`,
    )
    return deleted.rowCount ?? 0
  })
}

function assertDependentsSupported(rule: RetentionRule): void {
  if (!rule.dependents?.length) return
  if (rule.operation === 'redact' || keyCount(rule) !== 1) {
    throw new Error(
      `Retention rule '${rule.subject}' needs one key column and a delete to remove dependents`,
    )
  }
}

/** One batch of a rule without dependents: a bounded delete or redact. */
async function runPlainBatch(
  db: Database,
  rule: RetentionRule,
  keys: SQL,
  candidates: SQL,
  predicate: SQL,
): Promise<number> {
  const table = sql.identifier(rule.table)
  const statement =
    rule.operation === 'redact'
      ? sql`UPDATE ${table} SET ${sql.join(
          rule.redactColumns.map((column) => sql`${sql.identifier(column)} = NULL`),
          sql`, `,
        )} WHERE (${keys}) IN (${candidates}) AND ${predicate} RETURNING ${keys}`
      : sql`DELETE FROM ${table} WHERE (${keys}) IN (${candidates}) AND ${predicate} RETURNING ${keys}`
  return (await db.execute(statement)).rowCount ?? 0
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
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1) {
    throw new Error('maxBatches must be a positive safe integer')
  }
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

  const dependents = rule.dependents ?? []
  assertDependentsSupported(rule)

  for (;;) {
    const candidates = sql`SELECT ${keys} FROM ${table} WHERE ${predicate} ORDER BY ${sql.identifier(orderColumn)} ASC LIMIT ${batchSize}`
    const count =
      dependents.length > 0
        ? await deleteWithDependents(db, rule, dependents, candidates, predicate)
        : await runPlainBatch(db, rule, keys, candidates, predicate)
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
