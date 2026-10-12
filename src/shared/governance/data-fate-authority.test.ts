import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '#/shared/db/schema'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { DATA_FATE_AUTHORITY, dataFateKey } from './data-fate-authority'

// Every schema module, keyed by the file name the authority records.
const SCHEMA_MODULES = Object.fromEntries(
  Object.entries(
    import.meta.glob<Record<string, unknown>>(
      ['../db/schema/*.ts', '!../db/schema/*.test.ts'],
      {
        eager: true,
      },
    ),
  ).map(([path, module]) => [path.slice(path.lastIndexOf('/') + 1), module]),
)

function tableExports(module: Record<string, unknown> | undefined): readonly string[] {
  return Object.entries(module ?? {})
    .filter(([, value]) => isTable(value))
    .map(([name]) => name)
}

/** The PostgreSQL name of a table the schema barrel exports, or null. */
function databaseTableName(exportName: string): string | null {
  const table = (schema as Record<string, unknown>)[exportName]
  return isTable(table) ? getTableName(table) : null
}

/** The retention sweep's rules over one table, as the sweep states them. */
const sweepRulesOver = (table: string) =>
  RETENTION_RULES.filter((rule) => rule.table === table)

describe('data-fate authority', () => {
  it('records each table under the schema file that exports it', () => {
    const misfiled = DATA_FATE_AUTHORITY.filter(
      (row) => !tableExports(SCHEMA_MODULES[row.schemaFile]).includes(row.exportName),
    ).map((row) => dataFateKey(row.schemaFile, row.exportName))

    expect(misfiled).toEqual([])
  })

  it('retains the goal month target log as history, like the other Goal history tables', () => {
    const goalFate = (exportName: string) =>
      DATA_FATE_AUTHORITY.find(
        (row) => row.schemaFile === 'goal.schema.ts' && row.exportName === exportName,
      )

    expect(goalFate('goalMonthTargetChanges')).toEqual({
      ...goalFate('goalResultRevisions'),
      exportName: 'goalMonthTargetChanges',
    })
    expect(goalFate('goalMonthTargetChanges')).toMatchObject({
      owner: 'reporting',
      disposition: 'recoverable_archive',
    })
  })

  it('files no table the retention sweep deletes rows from as a read-only compatibility table', () => {
    // `compatibility_read` says "keep read-only until nothing depends on it".
    // A table the sweep deletes from by age is not being kept, so the two
    // records would contradict each other.
    const deletedFromByAge = new Set(
      RETENTION_RULES.filter(({ operation }) => (operation ?? 'delete') === 'delete').map(
        ({ table }) => table,
      ),
    )
    const keptReadOnlyYetDeleted = DATA_FATE_AUTHORITY.filter(
      (row) => row.disposition === 'compatibility_read',
    )
      .map((row) => databaseTableName(row.exportName))
      .filter((table) => table !== null && deletedFromByAge.has(table))

    expect(keptReadOnlyYetDeleted).toEqual([])
  })

  it('files the visit record as a live Guest table and names every sweep rule over it', () => {
    const visitRecord = DATA_FATE_AUTHORITY.find(
      (row) => row.schemaFile === 'guest.schema.ts' && row.exportName === 'scanEvents',
    )
    const sweepSubjects = sweepRulesOver('scan_events').map(({ subject }) => subject)

    expect(visitRecord).toMatchObject({ owner: 'guest', disposition: 'active_authority' })
    expect(sweepSubjects).toEqual([
      'scan_events.abuse_pseudonym',
      'scan_events.guest_session_pseudonym',
      'scan_events.deidentified_fact',
    ])
    for (const subject of sweepSubjects) {
      expect(visitRecord?.exitCriteria, subject).toContain(subject)
    }
  })

  it('keeps the two mirrors nothing writes as read-only compatibility tables', () => {
    const mirrors = DATA_FATE_AUTHORITY.filter(
      (row) => row.disposition === 'compatibility_read',
    ).map((row) => row.exportName)

    expect(mirrors).toEqual(['feedback', 'ratings'])
    for (const mirror of mirrors) {
      const operations = sweepRulesOver(databaseTableName(mirror) ?? '').map(
        ({ operation }) => operation,
      )
      expect(operations, mirror).toEqual(['redact', 'redact'])
    }
  })

  it('reaches every table a schema file exports through the schema barrel', () => {
    const barrel = new Set(tableExports(schema))
    const unreachable = Object.entries(SCHEMA_MODULES).flatMap(([file, module]) =>
      tableExports(module)
        .filter((name) => !barrel.has(name))
        .map((name) => dataFateKey(file, name)),
    )

    expect(unreachable).toEqual([])
  })
})
