import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  goalDefinitionVersions,
  goalEvaluations,
  goalPeriods,
  goalRefreshReceipts,
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
  it('binds each period to the same tenant, definition, and immutable version', () => {
    expect(foreignKeyColumns(goalPeriods, 'goal_periods_version_fk')).toEqual({
      local: ['organization_id', 'property_id', 'definition_id', 'definition_version_id'],
      foreign: ['organization_id', 'property_id', 'definition_id', 'id'],
    })
    expect(
      getTableConfig(goalDefinitionVersions).uniqueConstraints.some(
        (constraint) =>
          constraint.name === 'goal_definition_versions_org_property_definition_id_key',
      ),
    ).toBe(true)
  })

  it('binds each evaluation to its period definition and version', () => {
    expect(foreignKeyColumns(goalEvaluations, 'goal_evaluations_period_fk')).toEqual({
      local: [
        'organization_id',
        'property_id',
        'definition_id',
        'definition_version_id',
        'period_id',
      ],
      foreign: [
        'organization_id',
        'property_id',
        'definition_id',
        'definition_version_id',
        'id',
      ],
    })
  })

  it('binds refresh receipts to an evaluation from the same tenant and period', () => {
    expect(
      foreignKeyColumns(goalRefreshReceipts, 'goal_refresh_receipts_evaluation_fk'),
    ).toEqual({
      local: ['organization_id', 'property_id', 'period_id', 'evaluation_id'],
      foreign: ['organization_id', 'property_id', 'period_id', 'id'],
    })
  })
})
