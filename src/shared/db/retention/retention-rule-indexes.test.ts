import { getTableName, isTable, type SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { CONCURRENT_INDEX_REGISTRY } from '../concurrent-index-registry'
import * as schema from '../schema/migratable'
import type { RetentionRule } from './execute-retention-rule'

// Every batch of a retention rule is
// `SELECT <key> FROM <table> WHERE <ts> < $1 [AND extra] ORDER BY <ts> LIMIT n`
// (execute-retention-rule.ts), the last, empty batch included. Without an
// index that leads with the rule's timestamp column each batch reads and sorts
// the whole table, so the daily cost grows with history while the work does
// not.
//
// Leading with the timestamp is enough for a delete: the rows a batch matched
// are gone, so the next batch starts at the first row still due. It is not
// enough for a redaction, which keeps its rows. Everything already redacted
// stays below the cutoff, and a plain index makes each batch pass all of it to
// find the few rows that still hold a value. A redaction therefore needs a
// partial index over exactly the rows it has not cleared yet.
//
// A partial index counts only when the rule states its predicate: PostgreSQL
// cannot use one whose predicate the statement does not imply.

type TimestampIndex = Readonly<{
  name: string
  /** Bare column names and single spaces, as the rule registry writes one; null when the index covers every row. */
  predicate: string | null
}>

const tables = new Map<string, PgTable>()
for (const value of Object.values(schema as Record<string, unknown>)) {
  if (isTable(value)) tables.set(getTableName(value), value as PgTable)
}

const dialect = new PgDialect()

function plainPredicate(text: string): string {
  return text.replaceAll('"', '').replace(/\s+/g, ' ').trim()
}

/** A model predicate in the registry's spelling. One with bound values never equals a rule's text. */
function modelPredicate(tableName: string, where: SQL | undefined): string | null {
  if (!where) return null
  return plainPredicate(dialect.sqlToQuery(where).sql.replaceAll(`"${tableName}".`, ''))
}

/** Every index, key and unique constraint the model declares that leads with the column. */
function modelIndexesLeadingWith(
  table: PgTable,
  column: string,
): readonly TimestampIndex[] {
  const config = getTableConfig(table)
  const indexed = config.indexes.flatMap((index): TimestampIndex[] => {
    const [first] = index.config.columns
    const leading = first && 'name' in first ? first.name : undefined
    if (leading !== column) return []
    return [
      {
        name: index.config.name ?? '',
        predicate: modelPredicate(config.name, index.config.where),
      },
    ]
  })
  const keyed = [
    ...config.primaryKeys.map((key) => key.columns[0]?.name),
    ...config.uniqueConstraints.map((unique) => unique.columns[0]?.name),
    ...config.columns
      .filter((item) => item.primary || item.isUnique)
      .map((item) => item.name),
  ]
    .filter((name) => name === column)
    .map((): TimestampIndex => ({ name: `${config.name} key`, predicate: null }))
  return [...indexed, ...keyed]
}

/** Every index the concurrent sidecar builds on the table that leads with the column. */
function sidecarIndexesLeadingWith(
  tableName: string,
  column: string,
): readonly TimestampIndex[] {
  return CONCURRENT_INDEX_REGISTRY.filter(
    (spec) => spec.table === tableName && spec.columns[0] === column,
  ).map((spec) => {
    const [, where] = spec.createSql.split(/\bWHERE\b/)
    return { name: spec.name, predicate: where ? plainPredicate(where) : null }
  })
}

function servesRule(rule: RetentionRule, index: TimestampIndex): boolean {
  if (index.predicate === null) return rule.operation !== 'redact'
  return (
    rule.extraWhere !== undefined && index.predicate === plainPredicate(rule.extraWhere)
  )
}

function servingIndexNames(rule: RetentionRule): readonly string[] {
  const model = tables.get(rule.table)
  return [
    ...(model ? modelIndexesLeadingWith(model, rule.tsColumn) : []),
    ...sidecarIndexesLeadingWith(rule.table, rule.tsColumn),
  ]
    .filter((index) => servesRule(rule, index))
    .map((index) => index.name)
}

function ruleFor(subject: string): RetentionRule {
  const rule = RETENTION_RULES.find((candidate) => candidate.subject === subject)
  if (!rule) throw new Error(`${subject} is not a retention rule`)
  return rule
}

/**
 * Rules with no index for their batch, each for a stated reason.
 * `ratings` and `feedback` are pre-beta inventory with no writer (the Guest
 * Response tables replaced them), so their scans do not grow.
 */
const NOT_LED_BY_TIMESTAMP: Readonly<Record<string, string>> = {
  'ratings.abuse_pseudonym': 'pre-beta inventory, no writer',
  'ratings.guest_session_pseudonym': 'pre-beta inventory, no writer',
  'feedback.abuse_pseudonym': 'pre-beta inventory, no writer',
  'feedback.guest_session_pseudonym': 'pre-beta inventory, no writer',
  // The rule reads two states by equality, then the timestamp.
  notification_digest_batches:
    'served by notification_digest_batches_retention_idx (state, updated_at)',
}

describe('retention rule indexes', () => {
  it('gives every rule an index its batch can use', () => {
    const unindexed = RETENTION_RULES.filter(
      (rule) =>
        !(rule.subject in NOT_LED_BY_TIMESTAMP) && servingIndexNames(rule).length === 0,
    ).map(
      ({ subject, table, tsColumn, operation = 'delete' }) =>
        `${subject}: ${operation} on ${table} (${tsColumn})`,
    )

    expect(unindexed).toEqual([])
  })

  // scan_events is written on every Portal visit and its rows stay for 24
  // months. `ip_hash` is no longer written at all, so a plain index would have
  // that rule pass every scan older than seven days, every day, to redact
  // nothing.
  it('serves each scan_events redaction from the rows it has not cleared, not from the plain index', () => {
    expect({
      abuse: servingIndexNames(ruleFor('scan_events.abuse_pseudonym')),
      session: servingIndexNames(ruleFor('scan_events.guest_session_pseudonym')),
      visitFact: servingIndexNames(ruleFor('scan_events.deidentified_fact')),
    }).toEqual({
      abuse: ['scan_events_ip_hash_redaction_idx'],
      session: ['scan_events_session_id_redaction_idx'],
      visitFact: ['scan_events_created_at_idx'],
    })
  })

  // notification_email_queue_immediate_acceptance_health_idx leads with
  // created_at too, but only over immediate rows with no not_before, which the
  // rule does not ask for.
  it('does not count a partial index whose predicate the rule does not state', () => {
    expect(servingIndexNames(ruleFor('notification_email_queue'))).toEqual([
      'notification_email_queue_created_at_idx',
    ])
  })

  it('names only rules that exist among the stated exceptions', () => {
    const subjects = new Set(RETENTION_RULES.map(({ subject }) => subject))

    expect(
      Object.keys(NOT_LED_BY_TIMESTAMP).filter((subject) => !subjects.has(subject)),
    ).toEqual([])
  })
})
