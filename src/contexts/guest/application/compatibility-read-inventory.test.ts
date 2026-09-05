import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as guestSchema from '#/shared/db/schema/guest.schema'
import * as portalSchema from '#/shared/db/schema/portal.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  COMPATIBILITY_READ_TABLES,
  buildCompatibilityReadInventoryReport,
  canonicalCompatibilityReadInventoryReport,
} from './compatibility-read-inventory'

const ROOT = process.cwd()

const EMPTY_ROWS = COMPATIBILITY_READ_TABLES.map(({ tableName }) => ({
  tableName,
  rowCount: 0,
}))

const RECONSTRUCTABLE_FK = Object.freeze({
  sourceColumns: ['source_id'] as const,
  targetColumns: ['id'] as const,
  onUpdate: 'no_action' as const,
  matchType: 'simple' as const,
  onDeleteSetColumns: null,
  deferrable: false,
  initiallyDeferred: false,
})

const SCHEMA_MODULES: Readonly<Record<string, Readonly<Record<string, unknown>>>> =
  Object.freeze({
    'guest.schema.ts': guestSchema,
    'portal.schema.ts': portalSchema,
  })

describe('compatibility-read inventory', () => {
  it('covers exactly the four remaining compatibility_read tables', () => {
    const authorityRows = DATA_FATE_AUTHORITY.filter(
      ({ disposition }) => disposition === 'compatibility_read',
    )
    const authorityTableNames = authorityRows.map((row) => {
      const value = SCHEMA_MODULES[row.schemaFile]?.[row.exportName]
      expect(isTable(value), `${row.schemaFile}#${row.exportName}`).toBe(true)
      return getTableName(value as Parameters<typeof getTableName>[0])
    })

    expect(authorityRows).toHaveLength(4)
    expect([...authorityTableNames].sort()).toEqual([
      'feedback',
      'portal_group_members',
      'ratings',
      'scan_events',
    ])
    expect(COMPATIBILITY_READ_TABLES.map(({ tableName }) => tableName).sort()).toEqual(
      [...authorityTableNames].sort(),
    )

    for (const table of COMPATIBILITY_READ_TABLES) {
      const row = authorityRows.find(
        ({ exportName }) => exportName === table.drizzleExportName,
      )
      expect(row, table.tableName).toBeDefined()
      expect(table.authority, table.tableName).toBe(row!.authority)
      expect(table.dataFateDisposition, table.tableName).toBe('compatibility_read')
    }
    expect(
      COMPATIBILITY_READ_TABLES.filter(
        ({ authority }) => authority === 'GST-01/MET-01/CNV-01',
      ).length,
    ).toBe(3)
    expect(
      COMPATIBILITY_READ_TABLES.filter(
        ({ authority }) => authority === 'POR-01/PPL-01/CNV-01',
      ).length,
    ).toBe(1)
  })

  it('sources activeReaderCount from a reader registry that names real modules', () => {
    for (const table of COMPATIBILITY_READ_TABLES) {
      expect(table.activeReaderCount, table.tableName).toBe(table.activeReaders.length)
      for (const module of table.activeReaders) {
        expect(existsSync(join(ROOT, module)), module).toBe(true)
        // A registered reader must actually name the Drizzle export it reads,
        // otherwise the count is a claim rather than evidence.
        expect(readFileSync(join(ROOT, module), 'utf8'), module).toContain(
          table.drizzleExportName,
        )
      }
    }

    const byTable = new Map(
      COMPATIBILITY_READ_TABLES.map((table) => [
        table.tableName,
        table.activeReaderCount,
      ]),
    )
    // The three Google import mirrors that used to sit here were deleted with
    // their tables; what remains all has live readers.
    expect(byTable.get('feedback')).toBeGreaterThan(0)
    expect(byTable.get('portal_group_members')).toBeGreaterThan(0)
  })

  it('never reports a compatibility mirror as a contraction candidate', () => {
    const empty = buildCompatibilityReadInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [],
    })

    // Zero rows, zero foreign keys: every mechanical precondition is clear and
    // the answer is still false. Removal needs one verified release plus a
    // restore proof, which no inventory can observe.
    expect(empty.totalRows).toBe(0)
    expect(empty.schemaContractionCandidate).toBe(false)
    expect(empty.blockers).toContain(
      'compatibility_read_removal_requires_verified_release_and_restore_proof',
    )
    expect(
      COMPATIBILITY_READ_TABLES.every(
        ({ contractionRequirement }) =>
          contractionRequirement === 'verified_release_and_restore_proof_then_review',
      ),
    ).toBe(true)
  })

  it('emits classifications, counts, and schema metadata only', () => {
    const report = buildCompatibilityReadInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'ratings' ? { ...row, rowCount: 9 } : row,
      ),
      foreignKeys: [],
    })

    expect(Object.keys(report).sort()).toEqual([
      'activeReaderCount',
      'blockers',
      'evaluatedAt',
      'externalInboundDependencies',
      'externalOutboundDependencies',
      'fingerprint',
      'foreignKeys',
      'nonemptyTableCount',
      'schemaContractionCandidate',
      'tableCount',
      'tables',
      'totalRows',
      'version',
    ])
    expect(Object.keys(report.tables[0]!).sort()).toEqual([
      'activeReaderCount',
      'activeReaders',
      'authority',
      'contractionRequirement',
      'dataClass',
      'dataFateDisposition',
      'drizzleExportName',
      'lifecycleOwner',
      'rowCount',
      'sourceContext',
      'tableName',
    ])
    expect(report).toMatchObject({
      version: 'compatibility-read-inventory-v1',
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      tableCount: 4,
      nonemptyTableCount: 1,
      totalRows: 9,
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // No guest content may reach the artifact: no rating value, no feedback
    // text, no scan identifier.
    expect(JSON.stringify(report)).not.toMatch(/comment|session_id|rating_value|payload/u)
  })

  it('requires one exact count per table and rejects unknown tables', () => {
    expect(() =>
      buildCompatibilityReadInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: EMPTY_ROWS.slice(1),
        foreignKeys: [],
      }),
    ).toThrow('compatibility_read_inventory_table_mismatch')

    expect(() =>
      buildCompatibilityReadInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [
          ...EMPTY_ROWS,
          { tableName: 'guest_responses' as never, rowCount: 0 },
        ],
        foreignKeys: [],
      }),
    ).toThrow('compatibility_read_inventory_table_mismatch')
  })

  it('produces a stable fingerprint that moves when any count moves', () => {
    const input = {
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [
        {
          constraintName: 'portal_group_members_portal_id_portals_id_fk',
          sourceSchema: 'public',
          sourceTable: 'portal_group_members',
          targetSchema: 'public',
          targetTable: 'portals',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'cascade' as const,
          validated: true,
        },
      ],
    }

    const first = buildCompatibilityReadInventoryReport(input)
    const reordered = buildCompatibilityReadInventoryReport({
      ...input,
      tableRows: [...EMPTY_ROWS].reverse(),
    })
    const moved = buildCompatibilityReadInventoryReport({
      ...input,
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'scan_events' ? { ...row, rowCount: 2 } : row,
      ),
    })

    expect(reordered).toEqual(first)
    expect(moved.fingerprint).not.toBe(first.fingerprint)
    expect(first.externalOutboundDependencies).toHaveLength(1)
    expect(canonicalCompatibilityReadInventoryReport(first)).toBe(
      JSON.stringify(first, null, 2),
    )
  })

  it('rejects ambiguous foreign-key evidence instead of fingerprinting it', () => {
    const foreignKey = {
      constraintName: 'portal_group_members_portal_id_portals_id_fk',
      sourceSchema: 'public',
      sourceTable: 'portal_group_members',
      targetSchema: 'public',
      targetTable: 'portals',
      ...RECONSTRUCTABLE_FK,
      onDelete: 'cascade' as const,
      validated: true,
    }

    for (const malformedForeignKey of [
      { ...foreignKey, sourceColumns: [] },
      { ...foreignKey, deferrable: false, initiallyDeferred: true },
      { ...foreignKey, onDelete: 'set_null' as const, onDeleteSetColumns: ['other_id'] },
      {
        ...foreignKey,
        sourceSchema: 'archive',
        sourceTable: 'old_members',
        targetSchema: 'archive',
        targetTable: 'old_portals',
      },
    ]) {
      expect(() =>
        buildCompatibilityReadInventoryReport({
          evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
          tableRows: EMPTY_ROWS,
          foreignKeys: [malformedForeignKey],
        }),
      ).toThrow('compatibility_read_inventory_foreign_key_invalid')
    }
  })
})
