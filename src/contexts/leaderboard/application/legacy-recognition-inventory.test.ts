import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as badgeSchema from '#/shared/db/schema/badge.schema'
import * as leaderboardSchema from '#/shared/db/schema/leaderboard.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  LEGACY_RECOGNITION_TABLES,
  buildLegacyRecognitionInventoryReport,
  canonicalLegacyRecognitionInventoryReport,
} from './legacy-recognition-inventory'

const EMPTY_ROWS = LEGACY_RECOGNITION_TABLES.map(({ tableName }) => ({
  tableName,
  rowCount: 0,
}))

const RECONSTRUCTABLE_FK = Object.freeze({
  sourceColumns: ['source_id'] as const,
  targetColumns: ['id'] as const,
  onUpdate: 'no_action' as const,
  matchType: 'simple' as const,
  deferrable: false,
  initiallyDeferred: false,
})

describe('legacy Recognition inventory', () => {
  it('matches the exact Staff-owned REC-01/CNV-01 data-fate authority', () => {
    const schemaExports = {
      'badge.schema.ts': badgeSchema,
      'leaderboard.schema.ts': leaderboardSchema,
    } as const
    const authorityRows = DATA_FATE_AUTHORITY.filter(
      ({ authority }) => authority === 'REC-01/CNV-01',
    )
    const authorityTableNames = authorityRows.map((row) => {
      const value = schemaExports[row.schemaFile as keyof typeof schemaExports]?.[
        row.exportName as never
      ] as unknown
      expect(isTable(value), `${row.schemaFile}#${row.exportName}`).toBe(true)
      return getTableName(value as Parameters<typeof getTableName>[0])
    })

    expect(authorityRows).toHaveLength(13)
    expect(
      authorityRows.every(
        ({ owner, disposition }) =>
          owner === 'staff' && disposition === 'bounded_contraction',
      ),
    ).toBe(true)
    expect([...authorityTableNames].sort()).toEqual(
      LEGACY_RECOGNITION_TABLES.map(({ tableName }) => tableName).sort(),
    )
    expect(
      LEGACY_RECOGNITION_TABLES.every(
        ({ lifecycleOwner, dataFateDisposition, authority }) =>
          lifecycleOwner === 'staff' &&
          dataFateDisposition === 'bounded_contraction' &&
          authority === 'REC-01/CNV-01',
      ),
    ).toBe(true)
  })

  it('requires one exact count for every governed legacy table', () => {
    expect(() =>
      buildLegacyRecognitionInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: EMPTY_ROWS.slice(1),
        foreignKeys: [],
      }),
    ).toThrow('legacy_recognition_inventory_table_mismatch')

    expect(() =>
      buildLegacyRecognitionInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [...EMPTY_ROWS, EMPTY_ROWS[0]!],
        foreignKeys: [],
      }),
    ).toThrow('legacy_recognition_inventory_table_mismatch')
  })

  it('classifies retained rows and external dependencies without exposing records', () => {
    const tableRows = EMPTY_ROWS.map((row) =>
      row.tableName === 'badge_awards'
        ? { ...row, rowCount: 7 }
        : row.tableName === 'recognition_board_entries'
          ? { ...row, rowCount: 3 }
          : row,
    )
    const report = buildLegacyRecognitionInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows,
      foreignKeys: [
        {
          constraintName: 'notification_badge_award_fk',
          sourceSchema: 'notification_archive',
          sourceTable: 'notifications',
          targetSchema: 'public',
          targetTable: 'badge_awards',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict',
          validated: true,
        },
        {
          constraintName: 'recognition_entries_snapshot_fk',
          sourceSchema: 'public',
          sourceTable: 'recognition_board_entries',
          targetSchema: 'public',
          targetTable: 'recognition_board_snapshots',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict',
          validated: false,
        },
        {
          constraintName: 'recognition_awards_external_subject_fk',
          sourceSchema: 'public',
          sourceTable: 'recognition_awards',
          targetSchema: 'identity_archive',
          targetTable: 'subjects',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'no_action',
          validated: true,
        },
      ],
    })

    expect(report).toMatchObject({
      version: 'legacy-recognition-inventory-v3',
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      tableCount: 13,
      nonemptyTableCount: 2,
      totalRows: 10,
      schemaContractionCandidate: false,
      blockers: [
        'retained_rows_require_export_restore',
        'external_foreign_key_dependencies_require_disposition',
        'unvalidated_foreign_keys_require_repair',
      ],
    })
    expect(report.externalInboundDependencies).toEqual([
      {
        constraintName: 'notification_badge_award_fk',
        sourceSchema: 'notification_archive',
        sourceTable: 'notifications',
        targetSchema: 'public',
        targetTable: 'badge_awards',
        ...RECONSTRUCTABLE_FK,
        onDelete: 'restrict',
        validated: true,
      },
    ])
    expect(report.externalOutboundDependencies).toEqual([
      {
        constraintName: 'recognition_awards_external_subject_fk',
        sourceSchema: 'public',
        sourceTable: 'recognition_awards',
        targetSchema: 'identity_archive',
        targetTable: 'subjects',
        ...RECONSTRUCTABLE_FK,
        onDelete: 'no_action',
        validated: true,
      },
    ])
    expect(report.tables.find(({ tableName }) => tableName === 'badge_awards')).toEqual({
      tableName: 'badge_awards',
      sourceContext: 'badge',
      lifecycleOwner: 'staff',
      dataClass: 'legacy_competitive_badge',
      dataFateDisposition: 'bounded_contraction',
      authority: 'REC-01/CNV-01',
      contractionRequirement: 'export_restore_then_contract',
      rowCount: 7,
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(report)).not.toContain('targetId')
  })

  it('marks only an empty, dependency-clean, validated inventory as a contraction candidate', () => {
    const report = buildLegacyRecognitionInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [
        {
          constraintName: 'leaderboard_entries_snapshot_fk',
          sourceSchema: 'public',
          sourceTable: 'leaderboard_entries',
          targetSchema: 'public',
          targetTable: 'leaderboard_snapshots',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'cascade',
          validated: true,
        },
      ],
    })

    expect(report.schemaContractionCandidate).toBe(true)
    expect(report.blockers).toEqual([])
    expect(canonicalLegacyRecognitionInventoryReport(report)).toBe(
      JSON.stringify(report, null, 2),
    )
  })
})
