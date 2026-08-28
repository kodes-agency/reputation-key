import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { LEGACY_PEOPLE_TEAM_TABLES } from '../application/legacy-people-team-inventory'
import { readLegacyPeopleTeamInventory } from './legacy-people-team-inventory.repository'

function database(results: readonly ReadonlyArray<Record<string, unknown>>[]) {
  const execute = vi.fn()
  for (const rows of results) execute.mockResolvedValueOnce({ rows })
  const transaction = vi.fn(
    async (operation: (snapshot: unknown) => unknown, _config?: unknown) =>
      operation({ execute }),
  )
  return { db: { transaction } as unknown as Database, execute, transaction }
}

describe('legacy People/Team inventory repository', () => {
  it('reads exact content-free counts and foreign-key metadata', async () => {
    const { db, execute, transaction } = database([
      LEGACY_PEOPLE_TEAM_TABLES.map(({ tableName }) => ({
        table_name: tableName,
        row_count: tableName === 'team_memberships' ? '4' : '0',
      })),
      [
        {
          constraint_name: 'team_memberships_team_fk',
          source_schema: 'public',
          source_table: 'team_memberships',
          target_schema: 'public',
          target_table: 'teams',
          source_columns: ['team_id'],
          target_columns: ['id'],
          delete_action: 'r',
          update_action: 'a',
          match_type: 's',
          deferrable: false,
          initially_deferred: false,
          validated: true,
        },
      ],
    ])

    const report = await readLegacyPeopleTeamInventory(
      db,
      new Date('2026-08-28T00:00:00.000Z'),
    )

    expect(report.totalRows).toBe(4)
    expect(
      report.tables.find(({ tableName }) => tableName === 'team_memberships'),
    ).toMatchObject({ rowCount: 4 })
    expect(report.foreignKeys).toEqual([
      {
        constraintName: 'team_memberships_team_fk',
        sourceSchema: 'public',
        sourceTable: 'team_memberships',
        targetSchema: 'public',
        targetTable: 'teams',
        sourceColumns: ['team_id'],
        targetColumns: ['id'],
        onDelete: 'restrict',
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

  it('fails closed on unknown database metadata', async () => {
    const { db } = database([
      LEGACY_PEOPLE_TEAM_TABLES.map(({ tableName }) => ({
        table_name: tableName,
        row_count: '0',
      })),
      [
        {
          constraint_name: 'unexpected',
          source_schema: 'external',
          source_table: 'outside',
          target_schema: 'public',
          target_table: 'teams',
          source_columns: ['team_id'],
          target_columns: ['id'],
          delete_action: 'x',
          update_action: 'a',
          match_type: 's',
          deferrable: false,
          initially_deferred: false,
          validated: true,
        },
      ],
    ])

    await expect(
      readLegacyPeopleTeamInventory(db, new Date('2026-08-28T00:00:00.000Z')),
    ).rejects.toThrow('legacy_people_team_inventory_foreign_key_invalid')
  })
})
