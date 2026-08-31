import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { LEGACY_GOAL_TABLES } from '../application/legacy-goal-inventory'
import { readLegacyGoalInventory } from './legacy-goal-inventory.repository'

function database(results: readonly ReadonlyArray<Record<string, unknown>>[]) {
  const execute = vi.fn()
  for (const rows of results) execute.mockResolvedValueOnce({ rows })
  const transaction = vi.fn(
    async (operation: (snapshot: unknown) => unknown, _config?: unknown) =>
      operation({ execute }),
  )
  return { db: { transaction } as unknown as Database, execute, transaction }
}

describe('legacy Goal inventory repository', () => {
  it('reads exact content-free counts and reconstructable foreign-key metadata', async () => {
    const { db, execute, transaction } = database([
      LEGACY_GOAL_TABLES.map(({ tableName }, index) => ({
        table_name: tableName,
        row_count: index === 0 ? '4' : '0',
      })),
      [
        {
          constraint_name: 'goal_progress_goal_id_goals_id_fk',
          source_schema: 'public',
          source_table: 'goal_progress',
          target_schema: 'public',
          target_table: 'goals',
          source_columns: ['goal_id'],
          target_columns: ['id'],
          delete_action: 'c',
          delete_action_columns: null,
          update_action: 'a',
          match_type: 's',
          deferrable: false,
          initially_deferred: false,
          validated: true,
        },
      ],
    ])

    const report = await readLegacyGoalInventory(db, new Date('2026-08-28T00:00:00.000Z'))

    expect(report.totalRows).toBe(4)
    expect(report.tables.find(({ tableName }) => tableName === 'goals')).toMatchObject({
      rowCount: 4,
    })
    expect(report.foreignKeys).toEqual([
      {
        constraintName: 'goal_progress_goal_id_goals_id_fk',
        sourceSchema: 'public',
        sourceTable: 'goal_progress',
        targetSchema: 'public',
        targetTable: 'goals',
        sourceColumns: ['goal_id'],
        targetColumns: ['id'],
        onDelete: 'cascade',
        onDeleteSetColumns: null,
        onUpdate: 'no_action',
        matchType: 'simple',
        deferrable: false,
        initiallyDeferred: false,
        validated: true,
      },
    ])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
  })

  it('rejects unknown PostgreSQL foreign-key action codes', async () => {
    const { db } = database([
      LEGACY_GOAL_TABLES.map(({ tableName }) => ({
        table_name: tableName,
        row_count: '0',
      })),
      [
        {
          constraint_name: 'goal_progress_goal_id_goals_id_fk',
          source_schema: 'public',
          source_table: 'goal_progress',
          target_schema: 'public',
          target_table: 'goals',
          source_columns: ['goal_id'],
          target_columns: ['id'],
          delete_action: 'unknown',
          delete_action_columns: null,
          update_action: 'a',
          match_type: 's',
          deferrable: false,
          initially_deferred: false,
          validated: true,
        },
      ],
    ])

    await expect(
      readLegacyGoalInventory(db, new Date('2026-08-28T00:00:00.000Z')),
    ).rejects.toThrow('legacy_goal_inventory_foreign_key_invalid')
  })
})
