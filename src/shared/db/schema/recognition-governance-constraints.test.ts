import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { recognitionBoardEntries, recognitionBoardSnapshots } from './leaderboard.schema'
import { governedBadgeAwards, governedBadgeAwardStatusFacts } from './badge.schema'

function foreignKeyColumns(table: Parameters<typeof getTableConfig>[0], name: string) {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  )
  if (!foreignKey) throw new Error(`Missing foreign key ${name}`)
  const reference = foreignKey.reference()
  return {
    local: reference.columns.map((column) => column.name),
    foreign: reference.foreignColumns.map((column) => column.name),
  }
}

function checkNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).checks.map((constraint) => constraint.name)
}

describe('recognition governance constraints', () => {
  it('binds entries to a snapshot and group in the same tenant/property', () => {
    expect(
      foreignKeyColumns(
        recognitionBoardEntries,
        'recognition_board_entries_snapshot_tenant_fk',
      ),
    ).toEqual({
      local: ['organization_id', 'property_id', 'snapshot_id'],
      foreign: ['organization_id', 'property_id', 'id'],
    })
    expect(
      foreignKeyColumns(
        recognitionBoardEntries,
        'recognition_board_entries_portal_group_tenant_fk',
      ),
    ).toEqual({
      local: ['organization_id', 'property_id', 'portal_group_id'],
      foreign: ['organization_id', 'property_id', 'id'],
    })
  })

  it('enforces rank/status, evidence bounds, and ratio consistency in the database', () => {
    expect(checkNames(recognitionBoardEntries)).toEqual(
      expect.arrayContaining([
        'recognition_board_entries_rank_status_check',
        'recognition_board_entries_evidence_bounds_check',
        'recognition_board_entries_ratio_consistency_check',
        'recognition_board_entries_employment_check',
      ]),
    )
    expect(checkNames(recognitionBoardSnapshots)).toContain(
      'recognition_board_snapshots_employment_check',
    )
  })

  it('binds awards to their source snapshot and portal group in the same scope', () => {
    expect(
      foreignKeyColumns(
        governedBadgeAwards,
        'recognition_awards_source_snapshot_tenant_fk',
      ),
    ).toEqual({
      local: ['organization_id', 'property_id', 'source_snapshot_id'],
      foreign: ['organization_id', 'property_id', 'id'],
    })
    expect(
      foreignKeyColumns(governedBadgeAwards, 'recognition_awards_portal_group_tenant_fk'),
    ).toEqual({
      local: ['organization_id', 'property_id', 'portal_group_id'],
      foreign: ['organization_id', 'property_id', 'id'],
    })
  })

  it('binds replacement awards to the same tenant/property and prevents self replacement', () => {
    expect(
      foreignKeyColumns(
        governedBadgeAwardStatusFacts,
        'recognition_award_status_replacement_tenant_fk',
      ),
    ).toEqual({
      local: [
        'replacement_organization_id',
        'replacement_property_id',
        'replacement_award_id',
      ],
      foreign: ['organization_id', 'property_id', 'id'],
    })
    expect(checkNames(governedBadgeAwardStatusFacts)).toContain(
      'recognition_award_status_replacement_check',
    )
  })
})
