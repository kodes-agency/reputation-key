import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  goalMonthlyResults,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from './goal.schema'

const foreignKeyColumns = (table: Parameters<typeof getTableConfig>[0], name: string) => {
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

describe('Goal governance tenant constraints', () => {
  it('binds canonical assignments to an exact tenant, program version, and metric', () => {
    expect(
      foreignKeyColumns(goalSubjectAssignments, 'goal_subject_assignments_version_fk'),
    ).toEqual({
      local: [
        'organization_id',
        'property_id',
        'program_id',
        'program_version_id',
        'metric_key',
      ],
      foreign: ['organization_id', 'property_id', 'program_id', 'id', 'metric_key'],
    })
    expect(
      foreignKeyColumns(goalSubjectAssignments, 'goal_subject_assignments_portal_fk'),
    ).toEqual({
      local: ['organization_id', 'property_id', 'portal_id'],
      foreign: ['organization_id', 'property_id', 'id'],
    })
  })

  it('binds monthly results and revisions to the same tenant lineage', () => {
    expect(
      foreignKeyColumns(goalMonthlyResults, 'goal_monthly_results_assignment_fk'),
    ).toEqual({
      local: [
        'organization_id',
        'property_id',
        'program_id',
        'program_version_id',
        'assignment_id',
      ],
      foreign: [
        'organization_id',
        'property_id',
        'program_id',
        'program_version_id',
        'id',
      ],
    })
    expect(
      foreignKeyColumns(goalResultRevisions, 'goal_result_revisions_result_fk'),
    ).toEqual({
      local: ['organization_id', 'property_id', 'monthly_result_id'],
      foreign: ['organization_id', 'property_id', 'id'],
    })
  })

  it('pins Goal Program versions to one immutable governed metric version', () => {
    expect(
      foreignKeyColumns(goalProgramVersions, 'goal_program_versions_metric_version_fk'),
    ).toEqual({
      local: ['metric_definition_id', 'metric_definition_version_id'],
      foreign: ['definition_id', 'id'],
    })
  })
})
