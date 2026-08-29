// Integration context — the legacy GBP compatibility mirror counts.
//
// The section shape is already pinned by the application module, so what is
// asserted here is the part only the repository owns: the statement it really
// sends, the snapshot it sends it in, and the strictness of the text→number
// conversion. A fake `Database` captures the transaction options and the SQL,
// and the SQL is rendered through the real PostgreSQL dialect — that catches
// the two mistakes a mocked return value hides: counting the Drizzle export
// name instead of the physical table (the query then hits nothing and the
// mirror reads as "already empty"), and widening the projection past
// `count(*)` so cached provider content leaves the database.

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { LEGACY_GBP_COMPATIBILITY_TABLES } from '../application/legacy-gbp-compatibility-inventory'
import { readLegacyGbpCompatibilitySection } from './legacy-gbp-compatibility-inventory.repository'

const AS_OF = new Date('2026-08-28T00:00:00.000Z')

type TransactionConfig = Readonly<{ isolationLevel?: string; accessMode?: string }>

type Captured = { configs: TransactionConfig[]; statements: SQL[] }

const blank = (): Captured => ({ configs: [], statements: [] })

const fakeDb = (captured: Captured, rows: readonly unknown[]): Database =>
  ({
    transaction: async (
      operation: (snapshot: unknown) => Promise<unknown>,
      config?: TransactionConfig,
    ) => {
      captured.configs.push(config ?? {})
      return operation({
        execute: async (query: SQL) => {
          captured.statements.push(query)
          return { rows }
        },
      })
    },
  }) as unknown as Database

const countRows = (counts: Readonly<Record<string, string>>) =>
  Object.entries(counts).map(([table_name, row_count]) => ({ table_name, row_count }))

const EMPTY_COUNTS = Object.fromEntries(
  LEGACY_GBP_COMPATIBILITY_TABLES.map(({ tableName }) => [tableName, '0']),
)

const render = (captured: Captured): { sql: string; params: unknown[] } => {
  const [statement, ...rest] = captured.statements
  if (!statement || rest.length > 0) {
    throw new Error(`expected exactly one statement, saw ${captured.statements.length}`)
  }
  return new PgDialect().sqlToQuery(statement)
}

describe('legacy GBP compatibility inventory repository', () => {
  it('counts every mirror in one repeatable-read, read-only snapshot', async () => {
    const captured = blank()
    const section = await readLegacyGbpCompatibilitySection(
      fakeDb(
        captured,
        countRows({
          gbp_cache: '12',
          gbp_import_jobs: '3',
          gbp_import_legacy_history: '0',
        }),
      ),
      AS_OF,
    )

    expect(captured.configs).toEqual([
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ])
    expect(captured.statements).toHaveLength(1)
    expect(
      section.tables.map(({ tableName, rowCount }) => [tableName, rowCount]),
    ).toEqual([
      ['gbp_cache', 12],
      ['gbp_import_jobs', 3],
      ['gbp_import_legacy_history', 0],
    ])
    expect(section.totalRows).toBe(15)
    expect(section.tableCount).toBe(3)
    expect(section.schemaContractionCandidate).toBe(false)
    expect(section.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads the physical mirror tables, not the Drizzle export names', async () => {
    const captured = blank()
    await readLegacyGbpCompatibilitySection(
      fakeDb(captured, countRows(EMPTY_COUNTS)),
      AS_OF,
    )

    const { sql } = render(captured)
    for (const { tableName, drizzleExportName } of LEGACY_GBP_COMPATIBILITY_TABLES) {
      expect(sql, tableName).toContain(`FROM public."${tableName}"`)
      expect(sql, drizzleExportName).not.toContain(drizzleExportName)
    }
    // One branch per mirror, joined — a dropped branch would leave the section
    // short and `buildLegacyGbpCompatibilitySection` would reject the result.
    expect(sql.match(/UNION ALL/g)).toHaveLength(
      LEGACY_GBP_COMPATIBILITY_TABLES.length - 1,
    )
  })

  it('projects nothing but the table name and its row count', async () => {
    const captured = blank()
    await readLegacyGbpCompatibilitySection(
      fakeDb(captured, countRows(EMPTY_COUNTS)),
      AS_OF,
    )

    const { sql, params } = render(captured)
    expect(sql.match(/AS \w+/g)).toEqual(
      LEGACY_GBP_COMPATIBILITY_TABLES.flatMap(() => ['AS table_name', 'AS row_count']),
    )
    expect(sql.match(/count\(\*\)/g)).toHaveLength(LEGACY_GBP_COMPATIBILITY_TABLES.length)
    expect(sql).not.toMatch(/gbp_place_id|payload|initiated_by|place_id|user_id/u)
    // The statement is fully static: no operator input reaches PostgreSQL.
    expect(params).toEqual([])
  })

  it('rejects a count that is not a canonical non-negative integer', async () => {
    for (const rowCount of ['12.5', '-1', '007', ' 3', '', '1e3']) {
      await expect(
        readLegacyGbpCompatibilitySection(
          fakeDb(blank(), countRows({ ...EMPTY_COUNTS, gbp_cache: rowCount })),
          AS_OF,
        ),
        rowCount,
      ).rejects.toThrow('legacy_gbp_compatibility_count_invalid')
    }
  })

  it('rejects a count past the safe integer range instead of rounding it', async () => {
    await expect(
      readLegacyGbpCompatibilitySection(
        fakeDb(blank(), countRows({ ...EMPTY_COUNTS, gbp_cache: '9007199254740993' })),
        AS_OF,
      ),
    ).rejects.toThrow('legacy_gbp_compatibility_count_invalid')
  })

  it('rejects a row for a table outside the compatibility set', async () => {
    await expect(
      readLegacyGbpCompatibilitySection(
        fakeDb(blank(), countRows({ ...EMPTY_COUNTS, legacy_import_control: '4' })),
        AS_OF,
      ),
    ).rejects.toThrow('legacy_gbp_compatibility_count_invalid')
  })

  it('refuses a snapshot that is missing a mirror', async () => {
    const { gbp_cache: _omitted, ...withoutCache } = EMPTY_COUNTS
    await expect(
      readLegacyGbpCompatibilitySection(fakeDb(blank(), countRows(withoutCache)), AS_OF),
    ).rejects.toThrow('legacy_gbp_compatibility_table_mismatch')
  })
})
