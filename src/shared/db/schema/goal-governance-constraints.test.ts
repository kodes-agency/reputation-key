import { describe, expect, it } from 'vitest'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import {
  goalMonthlyResults,
  goalMonthTargetChanges,
  goalResultRevisions,
  goalSubjectAssignments,
} from './goal.schema'

type Table = Parameters<typeof getTableConfig>[0]

const foreignKeyColumns = (table: Table, name: string) => {
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

const foreignKeyRule = (table: Table, name: string) =>
  getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name)
    ?.onDelete

const dialect = new PgDialect()

/** The CHECK as the model renders it, on one line. */
const checkSql = (table: Table, name: string): string => {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name,
  )
  if (!constraint) throw new Error(`Missing check ${name}`)
  return dialect.sqlToQuery(constraint.value).sql.replace(/\s+/gu, ' ').trim()
}

const column = (table: Table, name: string) => {
  const found = getTableConfig(table).columns.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Missing column ${name}`)
  return found
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
})

describe('Goal month target constraints', () => {
  it('lets a month carry its own target, or none', () => {
    const target = column(goalMonthlyResults, 'target_value')
    expect(target.notNull).toBe(false)
    expect(target.getSQLType()).toBe('numeric(30, 10)')
    expect(target.dataType).toBe('number')
    expect(checkSql(goalMonthlyResults, 'goal_monthly_results_target_value_check')).toBe(
      '"goal_monthly_results"."target_value" IS NULL OR "goal_monthly_results"."target_value" > 0',
    )
  })

  it('binds a target change to its month, Program and following version in one tenant', () => {
    for (const [name, local] of [
      ['goal_month_target_changes_result_fk', 'monthly_result_id'],
      ['goal_month_target_changes_program_fk', 'program_id'],
      ['goal_month_target_changes_following_version_fk', 'following_version_id'],
    ] as const) {
      expect(foreignKeyColumns(goalMonthTargetChanges, name), name).toEqual({
        local: ['organization_id', 'property_id', local],
        foreign: ['organization_id', 'property_id', 'id'],
      })
      expect(foreignKeyRule(goalMonthTargetChanges, name), name).toBe('restrict')
    }
  })

  it('requires the tenant, the month, the command and both values on every change', () => {
    for (const name of [
      'organization_id',
      'property_id',
      'program_id',
      'monthly_result_id',
      'change_id',
      'previous_target_value',
      'new_target_value',
      'following_outcome',
      'created_by',
      'created_at',
    ]) {
      expect(column(goalMonthTargetChanges, name).notNull, name).toBe(true)
    }
    for (const name of ['following_reason', 'following_version_id', 'note']) {
      expect(column(goalMonthTargetChanges, name).notNull, name).toBe(false)
    }
    for (const name of ['previous_target_value', 'new_target_value']) {
      expect(column(goalMonthTargetChanges, name).getSQLType(), name).toBe(
        'numeric(30, 10)',
      )
      expect(column(goalMonthTargetChanges, name).dataType, name).toBe('number')
    }
  })

  it('closes the outcome list, bounds the note and refuses a change to the same value', () => {
    expect(
      checkSql(goalMonthTargetChanges, 'goal_month_target_changes_outcome_check'),
    ).toBe(
      `"goal_month_target_changes"."following_outcome" IN ('applied', 'replaced_scheduled_change', 'kept_scheduled_change', 'not_applied', 'not_requested')`,
    )
    expect(checkSql(goalMonthTargetChanges, 'goal_month_target_changes_note_check')).toBe(
      '"goal_month_target_changes"."note" IS NULL OR char_length(btrim("goal_month_target_changes"."note")) BETWEEN 1 AND 500',
    )
    expect(
      checkSql(goalMonthTargetChanges, 'goal_month_target_changes_value_check'),
    ).toBe(
      '"goal_month_target_changes"."new_target_value" > 0 AND "goal_month_target_changes"."new_target_value" <> "goal_month_target_changes"."previous_target_value"',
    )
  })

  it('reads a Program’s changes in the order they were made', () => {
    const index = getTableConfig(goalMonthTargetChanges).indexes.find(
      (candidate) => candidate.config.name === 'goal_month_target_changes_program_idx',
    )
    expect(
      index?.config.columns.map((indexed) => ('name' in indexed ? indexed.name : null)),
    ).toEqual(['organization_id', 'property_id', 'program_id', 'created_at'])
  })
})
