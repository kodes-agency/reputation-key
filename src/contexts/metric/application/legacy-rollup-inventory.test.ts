import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as rollupSchema from '#/shared/db/schema/rollup.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  LEGACY_ROLLUP_TABLES,
  buildLegacyRollupInventoryReport,
  canonicalLegacyRollupInventoryReport,
} from './legacy-rollup-inventory'

const EMPTY_ROWS = LEGACY_ROLLUP_TABLES.map(({ tableName }) => ({
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

const REPORT_KEYS = [
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
]

const TABLE_KEYS = [
  'authority',
  'contractionRequirement',
  'dataClass',
  'dataFateDisposition',
  'lifecycleOwner',
  'rowCount',
  'sourceContext',
  'tableName',
]

describe('legacy Metric rollup inventory', () => {
  it('matches the exact Metric-owned MET-01/CNV-01 data-fate authority', () => {
    const authorityRows = DATA_FATE_AUTHORITY.filter(
      ({ authority, schemaFile }) =>
        authority === 'MET-01/CNV-01' && schemaFile === 'rollup.schema.ts',
    )
    const authorityTableNames = authorityRows.map((row) => {
      const value = rollupSchema[row.exportName as keyof typeof rollupSchema] as unknown
      expect(isTable(value), `${row.schemaFile}#${row.exportName}`).toBe(true)
      return getTableName(value as Parameters<typeof getTableName>[0])
    })

    expect(authorityRows).toHaveLength(4)
    expect(
      authorityRows.every(
        ({ owner, disposition }) =>
          owner === 'metric' && disposition === 'bounded_contraction',
      ),
    ).toBe(true)
    // The watermark table is physically `_rollup_watermarks`; the leading
    // underscore is easy to lose when a name is retyped from the Drizzle export.
    expect([...authorityTableNames].sort()).toEqual([
      '_rollup_watermarks',
      'rollup_daily_inbox_metrics',
      'rollup_daily_metrics',
      'rollup_weekly_metrics',
    ])
    expect(LEGACY_ROLLUP_TABLES.map(({ tableName }) => tableName).sort()).toEqual([
      '_rollup_watermarks',
      'rollup_daily_inbox_metrics',
      'rollup_daily_metrics',
      'rollup_weekly_metrics',
    ])
    expect(
      LEGACY_ROLLUP_TABLES.every(
        ({ sourceContext, lifecycleOwner, dataFateDisposition, authority }) =>
          sourceContext === 'metric' &&
          lifecycleOwner === 'metric' &&
          dataFateDisposition === 'bounded_contraction' &&
          authority === 'MET-01/CNV-01',
      ),
    ).toBe(true)
  })

  it('requires one exact count for every governed rollup table', () => {
    expect(() =>
      buildLegacyRollupInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: EMPTY_ROWS.slice(1),
        foreignKeys: [],
      }),
    ).toThrow('legacy_rollup_inventory_table_mismatch')

    expect(() =>
      buildLegacyRollupInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [...EMPTY_ROWS, EMPTY_ROWS[0]!],
        foreignKeys: [],
      }),
    ).toThrow('legacy_rollup_inventory_table_mismatch')
  })

  it('emits classifications, counts, and schema metadata only', () => {
    const report = buildLegacyRollupInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'rollup_daily_metrics' ? { ...row, rowCount: 12 } : row,
      ),
      foreignKeys: [],
    })

    expect(Object.keys(report).sort()).toEqual(REPORT_KEYS)
    expect(Object.keys(report.tables[0]!).sort()).toEqual(TABLE_KEYS)
    expect(report).toMatchObject({
      version: 'legacy-rollup-inventory-v1',
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      tableCount: 4,
      nonemptyTableCount: 1,
      totalRows: 12,
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // The rollup tables key on organization/property/portal/metric identifiers
    // and hold aggregate values; none of that may reach the artifact.
    expect(JSON.stringify(report)).not.toMatch(/metric_key|sum_value|avg_value/u)
  })

  it('produces a stable fingerprint that moves when any count moves', () => {
    const input = {
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [
        {
          constraintName: 'rollup_daily_metrics_property_fk',
          sourceSchema: 'public',
          sourceTable: 'rollup_daily_metrics',
          targetSchema: 'public',
          targetTable: 'properties',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'cascade' as const,
          validated: true,
        },
      ],
    }

    const first = buildLegacyRollupInventoryReport(input)
    const reordered = buildLegacyRollupInventoryReport({
      ...input,
      tableRows: [...EMPTY_ROWS].reverse(),
    })
    const moved = buildLegacyRollupInventoryReport({
      ...input,
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === '_rollup_watermarks' ? { ...row, rowCount: 1 } : row,
      ),
    })

    expect(reordered).toEqual(first)
    expect(reordered.fingerprint).toBe(first.fingerprint)
    expect(moved.fingerprint).not.toBe(first.fingerprint)
    expect(canonicalLegacyRollupInventoryReport(first)).toBe(
      JSON.stringify(first, null, 2),
    )
  })

  it('keeps the three Goal-contract blockers and refuses candidacy while any is present', () => {
    const empty = buildLegacyRollupInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [],
    })

    expect(empty.blockers).toEqual([])
    expect(empty.schemaContractionCandidate).toBe(true)

    const blocked = buildLegacyRollupInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'rollup_weekly_metrics' ? { ...row, rowCount: 3 } : row,
      ),
      foreignKeys: [
        {
          constraintName: 'metric_archive_rollup_fk',
          sourceSchema: 'metric_archive',
          sourceTable: 'rollup_history',
          targetSchema: 'public',
          targetTable: 'rollup_daily_metrics',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict' as const,
          validated: false,
        },
      ],
    })

    expect(blocked.blockers).toEqual([
      'retained_rows_require_export_restore',
      'external_foreign_key_dependencies_require_disposition',
      'unvalidated_foreign_keys_require_repair',
    ])
    expect(blocked.schemaContractionCandidate).toBe(false)
    expect(blocked.externalInboundDependencies).toHaveLength(1)
    expect(blocked.externalOutboundDependencies).toEqual([])
  })

  it('rejects ambiguous foreign-key evidence instead of fingerprinting it', () => {
    const foreignKey = {
      constraintName: 'rollup_daily_metrics_property_fk',
      sourceSchema: 'public',
      sourceTable: 'rollup_daily_metrics',
      targetSchema: 'public',
      targetTable: 'properties',
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
        sourceTable: 'old_rollups',
        targetSchema: 'archive',
        targetTable: 'properties',
      },
    ]) {
      expect(() =>
        buildLegacyRollupInventoryReport({
          evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
          tableRows: EMPTY_ROWS,
          foreignKeys: [malformedForeignKey],
        }),
      ).toThrow('legacy_rollup_inventory_foreign_key_invalid')
    }
  })
})
