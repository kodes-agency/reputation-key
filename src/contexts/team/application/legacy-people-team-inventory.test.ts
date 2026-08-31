import { getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as peopleAccessSchema from '#/shared/db/schema/people-access.schema'
import * as staffAssignmentSchema from '#/shared/db/schema/staff-assignment.schema'
import * as teamSchema from '#/shared/db/schema/team.schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import {
  LEGACY_PEOPLE_TEAM_TABLES,
  buildLegacyPeopleTeamInventoryReport,
  canonicalLegacyPeopleTeamInventoryReport,
} from './legacy-people-team-inventory'

const EMPTY_ROWS = LEGACY_PEOPLE_TEAM_TABLES.map(({ tableName }) => ({
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

describe('legacy People/Team contraction inventory', () => {
  it('matches the exact mixed-owner PPL-01/CNV-01 data-fate authority', () => {
    const schemaExports = {
      'people-access.schema.ts': peopleAccessSchema,
      'staff-assignment.schema.ts': staffAssignmentSchema,
      'team.schema.ts': teamSchema,
    } as const
    const authorityRows = DATA_FATE_AUTHORITY.filter(
      ({ authority, disposition }) =>
        authority === 'PPL-01/CNV-01' && disposition === 'bounded_contraction',
    )
    const authorityTableNames = authorityRows.map((row) => {
      const value = schemaExports[row.schemaFile as keyof typeof schemaExports]?.[
        row.exportName as never
      ] as unknown
      expect(isTable(value), `${row.schemaFile}#${row.exportName}`).toBe(true)
      return getTableName(value as Parameters<typeof getTableName>[0])
    })

    expect(authorityRows).toHaveLength(5)
    expect(
      authorityRows.map(({ exportName, owner }) => [exportName, owner]).sort(),
    ).toEqual([
      ['propertyAccessGrants', 'identity'],
      ['staffAssignments', 'staff'],
      ['teamMemberships', 'staff'],
      ['teamPortalGroupScopes', 'staff'],
      ['teams', 'staff'],
    ])
    expect([...authorityTableNames].sort()).toEqual(
      LEGACY_PEOPLE_TEAM_TABLES.map(({ tableName }) => tableName).sort(),
    )
  })

  it('requires one exact count for every governed legacy table', () => {
    expect(() =>
      buildLegacyPeopleTeamInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: EMPTY_ROWS.slice(1),
        foreignKeys: [],
      }),
    ).toThrow('legacy_people_team_inventory_table_mismatch')

    expect(() =>
      buildLegacyPeopleTeamInventoryReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tableRows: [...EMPTY_ROWS, EMPTY_ROWS[0]!],
        foreignKeys: [],
      }),
    ).toThrow('legacy_people_team_inventory_table_mismatch')
  })

  it('classifies retained rows and external dependencies without exposing records', () => {
    const tableRows = EMPTY_ROWS.map((row) =>
      row.tableName === 'staff_assignments'
        ? { ...row, rowCount: 7 }
        : row.tableName === 'team_memberships'
          ? { ...row, rowCount: 3 }
          : row,
    )
    const report = buildLegacyPeopleTeamInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows,
      foreignKeys: [
        {
          constraintName: 'external_team_reference_fk',
          sourceSchema: 'archive',
          sourceTable: 'team_notes',
          targetSchema: 'public',
          targetTable: 'teams',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict',
          validated: true,
        },
        {
          constraintName: 'team_membership_team_fk',
          sourceSchema: 'public',
          sourceTable: 'team_memberships',
          targetSchema: 'public',
          targetTable: 'teams',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict',
          validated: false,
        },
        {
          constraintName: 'staff_assignment_property_fk',
          sourceSchema: 'public',
          sourceTable: 'staff_assignments',
          targetSchema: 'public',
          targetTable: 'properties',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'cascade',
          validated: true,
        },
      ],
    })

    expect(report).toMatchObject({
      version: 'legacy-people-team-inventory-v2',
      evaluatedAt: '2026-08-28T00:00:00.000Z',
      tableCount: 5,
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
        constraintName: 'external_team_reference_fk',
        sourceSchema: 'archive',
        sourceTable: 'team_notes',
        targetSchema: 'public',
        targetTable: 'teams',
        ...RECONSTRUCTABLE_FK,
        onDelete: 'restrict',
        validated: true,
      },
    ])
    expect(report.externalOutboundDependencies).toEqual([
      {
        constraintName: 'staff_assignment_property_fk',
        sourceSchema: 'public',
        sourceTable: 'staff_assignments',
        targetSchema: 'public',
        targetTable: 'properties',
        ...RECONSTRUCTABLE_FK,
        onDelete: 'cascade',
        validated: true,
      },
    ])
    expect(
      report.tables.find(({ tableName }) => tableName === 'staff_assignments'),
    ).toMatchObject({
      sourceContext: 'staff',
      lifecycleOwner: 'staff',
      dataClass: 'legacy_combined_staff_assignment',
      dataFateDisposition: 'bounded_contraction',
      authority: 'PPL-01/CNV-01',
      contractionRequirement: 'export_restore_then_contract',
      rowCount: 7,
    })
    expect(
      report.tables.find(({ tableName }) => tableName === 'property_access_grants'),
    ).toMatchObject({
      sourceContext: 'staff',
      lifecycleOwner: 'identity',
      dataClass: 'legacy_property_access_grant',
      dataFateDisposition: 'bounded_contraction',
      authority: 'PPL-01/CNV-01',
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(report)).not.toContain('sourceId')
    expect(JSON.stringify(report)).not.toContain('organizationId')
    expect(JSON.stringify(report)).not.toContain('userId')
  })

  it('marks only an empty, dependency-clean, validated inventory as a candidate', () => {
    const report = buildLegacyPeopleTeamInventoryReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tableRows: EMPTY_ROWS,
      foreignKeys: [
        {
          constraintName: 'team_membership_team_fk',
          sourceSchema: 'public',
          sourceTable: 'team_memberships',
          targetSchema: 'public',
          targetTable: 'teams',
          ...RECONSTRUCTABLE_FK,
          onDelete: 'restrict',
          validated: true,
        },
      ],
    })

    expect(report.schemaContractionCandidate).toBe(true)
    expect(report.blockers).toEqual([])
    expect(canonicalLegacyPeopleTeamInventoryReport(report)).toBe(
      JSON.stringify(report, null, 2),
    )
  })
})
