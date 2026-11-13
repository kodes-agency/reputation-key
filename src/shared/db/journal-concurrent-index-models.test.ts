import { readFileSync } from 'node:fs'
import { getTableName, isTable } from 'drizzle-orm'
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { journalConcurrentIndex } from './journal-concurrent-index'
import { readMigrationJournal } from './migration-journal-order'
import * as schema from './schema/migratable'

// A concurrent index is built by its own journal file and declared in its
// table's model, so the model the application reads describes the database.
// Files whose table a later migration dropped have no model left to match.

const tables = new Map<string, PgTable>()
for (const value of Object.values(schema as Record<string, unknown>)) {
  if (isTable(value)) tables.set(getTableName(value), value as PgTable)
}

const dialect = new PgDialect()

function plain(text: string): string {
  return text
    .replaceAll('"', '')
    .replace(/\s+/g, ' ')
    .replace(/^\((.*)\)$/, '$1')
    .trim()
}

const journalIndexes = readMigrationJournal().flatMap(({ tag }) => {
  const spec = journalConcurrentIndex(
    readFileSync(new URL(`../../../drizzle/${tag}.sql`, import.meta.url), 'utf8'),
  )
  return spec && tables.has(spec.table) ? [{ tag, spec }] : []
})

function modelIndex(tableName: string, name: string) {
  const table = tables.get(tableName)
  if (!table) return undefined
  const index = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name,
  )
  if (!index) return undefined
  const { where, unique, columns } = index.config
  return {
    unique,
    columns: columns.map((column) => ('name' in column ? column.name : null)),
    predicate: where
      ? plain(dialect.sqlToQuery(where).sql.replaceAll(`"${tableName}".`, ''))
      : null,
  }
}

describe('journaled concurrent indexes', () => {
  it('builds the retention, metric and snapshot indexes in the journal', () => {
    const names = journalIndexes.map(({ spec }) => spec.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'review_provider_snapshot_runs_completed_property_idx',
        'metric_readings_org_prop_version_event_idx',
        'scan_events_ip_hash_redaction_idx',
        'audit_logs_created_at_idx',
        'review_provider_subjects_last_seen_run_idx',
        'authorization_execution_permits_created_at_idx',
      ]),
    )
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(journalIndexes.map(({ tag, spec }) => [tag, spec] as const))(
    '%s matches its model index',
    (_tag, spec) => {
      expect(modelIndex(spec.table, spec.name)).toEqual({
        unique: spec.unique,
        columns: spec.columns,
        predicate: spec.predicate === null ? null : plain(spec.predicate),
      })
    },
  )
})
