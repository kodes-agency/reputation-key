import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { readLegacyRecognitionInventory } from './legacy-recognition-inventory.repository'

let lease: TestLease
let db: Database

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await lease.release()
})

describe('legacy Recognition inventory (real PostgreSQL)', () => {
  it('accounts for every retained table and its live foreign-key metadata', async () => {
    const report = await readLegacyRecognitionInventory(
      db,
      new Date('2026-08-28T00:00:00.000Z'),
    )

    expect(report.tableCount).toBe(13)
    expect(report.tables).toHaveLength(13)
    expect(
      report.tables.find(({ tableName }) => tableName === 'badge_definitions'),
    ).toMatchObject({ rowCount: 3 })
    expect(
      report.tables.find(({ tableName }) => tableName === 'badge_definition_versions'),
    ).toMatchObject({ rowCount: 3 })
    expect(report.totalRows).toBe(6)
    expect(report.foreignKeys.length).toBeGreaterThan(0)
    expect(
      report.foreignKeys.every(
        ({ sourceColumns, targetColumns, onUpdate, matchType }) =>
          sourceColumns.length > 0 &&
          sourceColumns.length === targetColumns.length &&
          onUpdate.length > 0 &&
          matchType.length > 0,
      ),
    ).toBe(true)
    expect(report.foreignKeys.every(({ validated }) => validated)).toBe(true)
    expect(report.externalInboundDependencies).toEqual([])
    expect(report.blockers).toEqual(['retained_rows_require_export_restore'])
  })

  it('captures cross-schema inbound and outbound dependencies', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const fixtureSchema = `recognition_inventory_${suffix}`
    const outboundConstraint = `badge_awards_external_${suffix}`

    try {
      await lease.pool.query(`CREATE SCHEMA "${fixtureSchema}"`)
      await lease.pool.query(`
        CREATE TABLE "${fixtureSchema}".badge_definition_consumers (
          badge_definition_id uuid REFERENCES public.badge_definitions(id)
        )
      `)
      await lease.pool.query(`
        CREATE TABLE "${fixtureSchema}".badge_definition_targets (
          id uuid PRIMARY KEY
        )
      `)
      await lease.pool.query(`
        INSERT INTO "${fixtureSchema}".badge_definition_targets (id)
        SELECT DISTINCT badge_definition_id FROM public.badge_awards
      `)
      await lease.pool.query(`
        ALTER TABLE public.badge_awards
        ADD CONSTRAINT "${outboundConstraint}"
        FOREIGN KEY (badge_definition_id)
        REFERENCES "${fixtureSchema}".badge_definition_targets(id)
      `)

      const report = await readLegacyRecognitionInventory(
        db,
        new Date('2026-08-28T00:00:00.000Z'),
      )

      expect(report.externalInboundDependencies).toContainEqual(
        expect.objectContaining({
          sourceSchema: fixtureSchema,
          sourceTable: 'badge_definition_consumers',
          targetSchema: 'public',
          targetTable: 'badge_definitions',
        }),
      )
      expect(report.externalOutboundDependencies).toContainEqual(
        expect.objectContaining({
          sourceSchema: 'public',
          sourceTable: 'badge_awards',
          targetSchema: fixtureSchema,
          targetTable: 'badge_definition_targets',
        }),
      )
      expect(report.blockers).toContain(
        'external_foreign_key_dependencies_require_disposition',
      )
    } finally {
      await lease.pool.query(
        `ALTER TABLE public.badge_awards DROP CONSTRAINT IF EXISTS "${outboundConstraint}"`,
      )
      await lease.pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`)
    }
  })
})
