import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { readLegacyGoalInventory } from './legacy-goal-inventory.repository'

let lease: TestLease
let db: Database

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await lease.release()
})

describe('legacy Goal inventory (real PostgreSQL)', () => {
  it('accounts for both retained tables and their live foreign-key metadata', async () => {
    const report = await readLegacyGoalInventory(db, new Date('2026-08-28T00:00:00.000Z'))

    expect(report.tableCount).toBe(2)
    expect(report.tables).toHaveLength(2)
    expect(report.totalRows).toBe(
      report.tables.reduce((total, table) => total + table.rowCount, 0),
    )
    expect(report.tables.every(({ rowCount }) => rowCount >= 0)).toBe(true)

    expect(report.foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraintName: 'goal_progress_goal_id_goals_id_fk',
          sourceSchema: 'public',
          sourceTable: 'goal_progress',
          sourceColumns: ['goal_id'],
          targetSchema: 'public',
          targetTable: 'goals',
          targetColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        }),
        expect.objectContaining({
          constraintName: 'goals_property_id_properties_id_fk',
          sourceSchema: 'public',
          sourceTable: 'goals',
          sourceColumns: ['property_id'],
          targetSchema: 'public',
          targetTable: 'properties',
          targetColumns: ['id'],
          onDelete: 'cascade',
        }),
        expect.objectContaining({
          constraintName: 'goals_portal_id_portals_id_fk',
          sourceSchema: 'public',
          sourceTable: 'goals',
          sourceColumns: ['portal_id'],
          targetSchema: 'public',
          targetTable: 'portals',
          targetColumns: ['id'],
          onDelete: 'cascade',
        }),
        expect.objectContaining({
          constraintName: 'goals_portal_group_id_portal_groups_id_fk',
          sourceSchema: 'public',
          sourceTable: 'goals',
          sourceColumns: ['portal_group_id'],
          targetSchema: 'public',
          targetTable: 'portal_groups',
          targetColumns: ['id'],
          onDelete: 'set_null',
          onDeleteSetColumns: null,
        }),
        expect.objectContaining({
          constraintName: 'goals_parent_goal_id_goals_id_fk',
          sourceSchema: 'public',
          sourceTable: 'goals',
          sourceColumns: ['parent_goal_id'],
          targetSchema: 'public',
          targetTable: 'goals',
          targetColumns: ['id'],
          onDelete: 'set_null',
          onDeleteSetColumns: null,
        }),
      ]),
    )
    expect(
      report.foreignKeys.every(
        ({ sourceColumns, targetColumns, onUpdate, matchType }) =>
          sourceColumns.length > 0 &&
          sourceColumns.length === targetColumns.length &&
          onUpdate.length > 0 &&
          matchType.length > 0,
      ),
    ).toBe(true)
    expect(
      report.foreignKeys.every(
        ({ onDelete, onDeleteSetColumns }) =>
          onDeleteSetColumns === null ||
          ((onDelete === 'set_null' || onDelete === 'set_default') &&
            onDeleteSetColumns.length > 0),
      ),
    ).toBe(true)
    expect(report.foreignKeys.every(({ validated }) => validated)).toBe(true)
    expect(report.externalInboundDependencies).toEqual([])
    expect(
      report.externalOutboundDependencies.map(({ targetTable }) => targetTable),
    ).toEqual(expect.arrayContaining(['properties', 'portal_groups', 'portals']))
    expect(report.blockers.includes('retained_rows_require_export_restore')).toBe(
      report.totalRows > 0,
    )
    expect(report.schemaContractionCandidate).toBe(report.blockers.length === 0)
  })
})
