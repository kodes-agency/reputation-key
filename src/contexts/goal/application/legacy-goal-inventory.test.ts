import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as goalSchema from '#/shared/db/schema/goal.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  LEGACY_GOAL_TABLES,
  buildLegacyGoalInventoryReport,
  canonicalLegacyGoalInventoryReport,
} from './legacy-goal-inventory'

const EMPTY_ROWS = LEGACY_GOAL_TABLES.map(({ tableName }) => ({
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

describe('legacy Goal inventory', () => {
  it('matches the exact Goal-owned GOA-01/CNV-01 data-fate authority', () => {
    const authorityRows = DATA_FATE_AUTHORITY.filter(
      ({ authority }) => authority === 'GOA-01/CNV-01',
    )
    const authorityTableNames = authorityRows.map((row) => {
      const value = goalSchema[row.exportName as keyof typeof goalSchema] as unknown
      expect(isTable(value), `${row.schemaFile}#${row.exportName}`).toBe(true)
      return getTableName(value as Parameters<typeof getTableName>[0])
    })

    expect(authorityRows).toHaveLength(2)
    expect(
      authorityRows.every(
        ({ schemaFile, owner, disposition }) =>
          schemaFile === 'goal.schema.ts' &&
          owner === 'goal' &&
          disposition === 'bounded_contraction',
      ),
    ).toBe(true)
    expect([...authorityTableNames].sort()).toEqual(
      LEGACY_GOAL_TABLES.map(({ tableName }) => tableName).sort(),
    )
    expect(
      LEGACY_GOAL_TABLES.every(
        ({ lifecycleOwner, dataFateDisposition, authority }) =>
          lifecycleOwner === 'goal' &&
          dataFateDisposition === 'bounded_contraction' &&
          authority === 'GOA-01/CNV-01',
      ),
    ).toBe(true)
  })

  it('requires one exact count for every governed legacy table', () => {
    expect(() =>
      buildLegacyGoalInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: EMPTY_ROWS.slice(1),
        foreignKeys: [],
      }),
    ).toThrow('legacy_goal_inventory_table_mismatch')

    expect(() =>
      buildLegacyGoalInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [...EMPTY_ROWS, EMPTY_ROWS[0]!],
        foreignKeys: [],
      }),
    ).toThrow('legacy_goal_inventory_table_mismatch')
  })

  it('classifies retained rows and reconstructable dependencies without exposing records', () => {
    const report = buildLegacyGoalInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS.map((row) =>
        row.tableName === 'goals' ? { ...row, rowCount: 7 } : row,
      ),
      foreignKeys: [
        {
          constraintName: 'goal_archive_goal_fk',
          sourceSchema: 'goal_archive',
          sourceTable: 'goal_snapshots',
          targetSchema: 'public',
          targetTable: 'goals',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict',
          validated: true,
        },
        {
          constraintName: 'goal_progress_goal_fk',
          sourceSchema: 'public',
          sourceTable: 'goal_progress',
          targetSchema: 'public',
          targetTable: 'goals',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'cascade',
          validated: false,
        },
        {
          constraintName: 'goals_property_fk',
          sourceSchema: 'public',
          sourceTable: 'goals',
          targetSchema: 'public',
          targetTable: 'properties',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'cascade',
          validated: true,
        },
      ],
    })

    expect(report).toMatchObject({
      version: 'legacy-goal-inventory-v1',
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      tableCount: 2,
      nonemptyTableCount: 1,
      totalRows: 7,
      schemaContractionCandidate: false,
      blockers: [
        'retained_rows_require_export_restore',
        'external_foreign_key_dependencies_require_disposition',
        'unvalidated_foreign_keys_require_repair',
      ],
    })
    expect(report.externalInboundDependencies).toEqual([
      expect.objectContaining({
        constraintName: 'goal_archive_goal_fk',
        sourceSchema: 'goal_archive',
        targetSchema: 'public',
        targetTable: 'goals',
      }),
    ])
    expect(report.externalOutboundDependencies).toEqual([
      expect.objectContaining({
        constraintName: 'goals_property_fk',
        sourceSchema: 'public',
        sourceTable: 'goals',
        targetSchema: 'public',
        targetTable: 'properties',
      }),
    ])
    expect(report.tables.find(({ tableName }) => tableName === 'goals')).toEqual({
      tableName: 'goals',
      sourceContext: 'goal',
      lifecycleOwner: 'goal',
      dataClass: 'legacy_pre_beta_goal',
      dataFateDisposition: 'bounded_contraction',
      authority: 'GOA-01/CNV-01',
      contractionRequirement: 'export_restore_then_contract',
      rowCount: 7,
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(report)).not.toContain('Quarterly rating target')
  })

  it('produces the same canonical fingerprint regardless of database row order', () => {
    const foreignKeys = [
      {
        constraintName: 'goals_property_fk',
        sourceSchema: 'public',
        sourceTable: 'goals',
        targetSchema: 'public',
        targetTable: 'properties',
        ...RECONSTRUCTABLE_FK,
        onDelete: 'cascade' as const,
        validated: true,
      },
      {
        constraintName: 'goal_progress_goal_fk',
        sourceSchema: 'public',
        sourceTable: 'goal_progress',
        targetSchema: 'public',
        targetTable: 'goals',
        ...RECONSTRUCTABLE_FK,
        onDelete: 'cascade' as const,
        validated: true,
      },
    ]
    const input = {
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys,
    }

    const first = buildLegacyGoalInventoryReport(input)
    const reordered = buildLegacyGoalInventoryReport({
      ...input,
      tableRows: [...EMPTY_ROWS].reverse(),
      foreignKeys: [...foreignKeys].reverse(),
    })

    expect(first.schemaContractionCandidate).toBe(true)
    expect(first.blockers).toEqual([])
    expect(reordered).toEqual(first)
    expect(canonicalLegacyGoalInventoryReport(first)).toBe(JSON.stringify(first, null, 2))
  })

  it('rejects ambiguous foreign-key evidence instead of fingerprinting it', () => {
    const foreignKey = {
      constraintName: 'goal_progress_goal_fk',
      sourceSchema: 'public',
      sourceTable: 'goal_progress',
      targetSchema: 'public',
      targetTable: 'goals',
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
        sourceTable: 'old_goals',
        targetSchema: 'archive',
        targetTable: 'properties',
      },
    ]) {
      expect(() =>
        buildLegacyGoalInventoryReport({
          evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
          tableRows: EMPTY_ROWS,
          foreignKeys: [malformedForeignKey],
        }),
      ).toThrow('legacy_goal_inventory_foreign_key_invalid')
    }
  })
})
