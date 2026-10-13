import { getTableName, isTable } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { CONCURRENT_INDEX_REGISTRY } from '../concurrent-index-registry'
import * as schema from '../schema/migratable'

// Every batch of a retention rule is
// `SELECT <key> FROM <table> WHERE <ts> < $1 [AND extra] ORDER BY <ts> LIMIT n`
// (execute-retention-rule.ts), the last, empty batch included. Without an
// index that leads with the rule's timestamp column each batch reads and sorts
// the whole table, so the daily cost grows with history while the work does
// not.

const tables = new Map<string, PgTable>()
for (const value of Object.values(schema as Record<string, unknown>)) {
  if (isTable(value)) tables.set(getTableName(value), value as PgTable)
}

/** First column of every index the model declares on the table. */
function modelLeadingColumns(table: PgTable): readonly string[] {
  const config = getTableConfig(table)
  const indexed = config.indexes.map((index) => {
    const [first] = index.config.columns
    return first && 'name' in first ? first.name : undefined
  })
  const keyed = [
    ...config.primaryKeys.map((key) => key.columns[0]?.name),
    ...config.uniqueConstraints.map((unique) => unique.columns[0]?.name),
    ...config.columns
      .filter((column) => column.primary || column.isUnique)
      .map((column) => column.name),
  ]
  return [...indexed, ...keyed].filter((name): name is string => name !== undefined)
}

/** First column of every index the concurrent sidecar builds on the table. */
function sidecarLeadingColumns(tableName: string): readonly string[] {
  return CONCURRENT_INDEX_REGISTRY.filter((spec) => spec.table === tableName)
    .map((spec) => spec.columns[0])
    .filter((name): name is string => name !== undefined)
}

/**
 * Rules with no index leading with their timestamp, each for a stated reason.
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
  it('gives every swept table an index that leads with the rule timestamp', () => {
    const unindexed = RETENTION_RULES.filter(({ subject, table, tsColumn }) => {
      if (subject in NOT_LED_BY_TIMESTAMP) return false
      const model = tables.get(table)
      const leading = [
        ...(model ? modelLeadingColumns(model) : []),
        ...sidecarLeadingColumns(table),
      ]
      return !leading.includes(tsColumn)
    }).map(({ subject, table, tsColumn }) => `${subject}: ${table} (${tsColumn})`)

    expect(unindexed).toEqual([])
  })

  it('names only rules that exist among the stated exceptions', () => {
    const subjects = new Set(RETENTION_RULES.map(({ subject }) => subject))

    expect(
      Object.keys(NOT_LED_BY_TIMESTAMP).filter((subject) => !subjects.has(subject)),
    ).toEqual([])
  })
})
