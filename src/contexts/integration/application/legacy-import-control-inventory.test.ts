import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as compatibilitySchema from '#/shared/db/schema/google-import-compatibility.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  LEGACY_IMPORT_CONTROL_TABLES,
  buildLegacyImportControlInventoryReport,
  canonicalLegacyImportControlInventoryReport,
} from './legacy-import-control-inventory'

const EMPTY_ROWS = LEGACY_IMPORT_CONTROL_TABLES.map(({ tableName }) => ({
  tableName,
  rowCount: 0,
}))

const RECONSTRUCTABLE_FK = Object.freeze({
  sourceColumns: ['environment'] as const,
  targetColumns: ['environment'] as const,
  onUpdate: 'no_action' as const,
  matchType: 'simple' as const,
  onDeleteSetColumns: null,
  deferrable: false,
  initiallyDeferred: false,
})

/** Physical names of the compatibility mirrors this inventory must not claim. */
const COMPATIBILITY_MIRROR_TABLES = [
  'gbp_cache',
  'gbp_import_jobs',
  'gbp_import_legacy_history',
]

describe('legacy Google import control inventory', () => {
  it('covers exactly the two bounded_contraction import-control tables', () => {
    const authorityRows = DATA_FATE_AUTHORITY.filter(
      ({ schemaFile, disposition }) =>
        schemaFile === 'google-import-compatibility.schema.ts' &&
        disposition === 'bounded_contraction',
    )
    const authorityTableNames = authorityRows.map((row) => {
      const value = compatibilitySchema[
        row.exportName as keyof typeof compatibilitySchema
      ] as unknown
      expect(isTable(value), `${row.schemaFile}#${row.exportName}`).toBe(true)
      return getTableName(value as Parameters<typeof getTableName>[0])
    })

    expect(authorityRows).toHaveLength(2)
    expect(
      authorityRows.every(
        ({ owner, authority }) =>
          owner === 'integration' && authority === 'GGL-01/CNV-01',
      ),
    ).toBe(true)
    expect([...authorityTableNames].sort()).toEqual([
      'legacy_import_control',
      'legacy_import_effect_leases',
    ])
    expect(LEGACY_IMPORT_CONTROL_TABLES.map(({ tableName }) => tableName)).toEqual([
      'legacy_import_control',
      'legacy_import_effect_leases',
    ])
  })

  it('excludes the AI-02/GGL-01 compatibility mirrors, which are a separate review', () => {
    // gbp_cache, gbp_import_jobs and gbp_import_legacy_history are
    // compatibility_read, not bounded_contraction. Folding them into this
    // report would imply the import-control contraction decision covers them.
    const claimed = LEGACY_IMPORT_CONTROL_TABLES.map(({ tableName }) => tableName)
    for (const mirror of COMPATIBILITY_MIRROR_TABLES) {
      expect(claimed, mirror).not.toContain(mirror)
    }
    expect(
      DATA_FATE_AUTHORITY.filter(
        ({ schemaFile, disposition }) =>
          schemaFile === 'google-import-compatibility.schema.ts' &&
          disposition === 'compatibility_read',
      ),
    ).toHaveLength(3)
    expect(() =>
      buildLegacyImportControlInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [...EMPTY_ROWS, { tableName: 'gbp_cache' as never, rowCount: 0 }],
        foreignKeys: [],
      }),
    ).toThrow('legacy_import_control_inventory_table_mismatch')
  })

  it('emits classifications, counts, and schema metadata only', () => {
    const report = buildLegacyImportControlInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'legacy_import_control' ? { ...row, rowCount: 1 } : row,
      ),
      foreignKeys: [],
    })

    expect(Object.keys(report).sort()).toEqual([
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
    expect(report).toMatchObject({
      version: 'legacy-import-control-inventory-v1',
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      tableCount: 2,
      nonemptyTableCount: 1,
      totalRows: 1,
      blockers: ['retained_rows_require_export_restore'],
      schemaContractionCandidate: false,
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // Control rows carry an operator id, a reason, and drain timestamps.
    expect(JSON.stringify(report)).not.toMatch(/operator_id|worker_id|reason/u)
  })

  it('produces a stable fingerprint that moves when any count moves', () => {
    const input = {
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [
        {
          constraintName: 'legacy_import_effect_leases_control_fk',
          sourceSchema: 'public',
          sourceTable: 'legacy_import_effect_leases',
          targetSchema: 'public',
          targetTable: 'legacy_import_control',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict' as const,
          validated: true,
        },
      ],
    }

    const first = buildLegacyImportControlInventoryReport(input)
    const reordered = buildLegacyImportControlInventoryReport({
      ...input,
      tableRows: [...EMPTY_ROWS].reverse(),
    })
    const moved = buildLegacyImportControlInventoryReport({
      ...input,
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'legacy_import_effect_leases' ? { ...row, rowCount: 4 } : row,
      ),
    })

    expect(reordered).toEqual(first)
    expect(first.blockers).toEqual([])
    expect(first.schemaContractionCandidate).toBe(true)
    expect(moved.fingerprint).not.toBe(first.fingerprint)
    expect(canonicalLegacyImportControlInventoryReport(first)).toBe(
      JSON.stringify(first, null, 2),
    )
  })

  it('keeps the three Goal-contract blockers and refuses candidacy while any is present', () => {
    const blocked = buildLegacyImportControlInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) => ({ ...row, rowCount: 1 })),
      foreignKeys: [
        {
          constraintName: 'gbp_import_requests_control_fk',
          sourceSchema: 'public',
          sourceTable: 'gbp_import_requests',
          targetSchema: 'public',
          targetTable: 'legacy_import_control',
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
  })

  it('rejects ambiguous foreign-key evidence instead of fingerprinting it', () => {
    const foreignKey = {
      constraintName: 'legacy_import_effect_leases_control_fk',
      sourceSchema: 'public',
      sourceTable: 'legacy_import_effect_leases',
      targetSchema: 'public',
      targetTable: 'legacy_import_control',
      ...RECONSTRUCTABLE_FK,
      onDelete: 'restrict' as const,
      validated: true,
    }

    for (const malformedForeignKey of [
      { ...foreignKey, sourceColumns: [] },
      { ...foreignKey, deferrable: false, initiallyDeferred: true },
      { ...foreignKey, onDelete: 'set_null' as const, onDeleteSetColumns: ['other_id'] },
      {
        ...foreignKey,
        sourceSchema: 'archive',
        sourceTable: 'old_control',
        targetSchema: 'archive',
        targetTable: 'old_leases',
      },
    ]) {
      expect(() =>
        buildLegacyImportControlInventoryReport({
          evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
          tableRows: EMPTY_ROWS,
          foreignKeys: [malformedForeignKey],
        }),
      ).toThrow('legacy_import_control_inventory_foreign_key_invalid')
    }
  })
})
