import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { readLegacyPeopleTeamInventory } from './legacy-people-team-inventory.repository'

let lease: TestLease
let db: Database

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await lease.release()
})

describe('legacy People/Team inventory (real PostgreSQL)', () => {
  it('accounts for every retained table and its live foreign-key metadata', async () => {
    const report = await readLegacyPeopleTeamInventory(
      db,
      new Date('2026-08-28T00:00:00.000Z'),
    )

    expect(report.tableCount).toBe(5)
    expect(report.tables.map(({ tableName }) => tableName).sort()).toEqual([
      'property_access_grants',
      'staff_assignments',
      'team_memberships',
      'team_portal_group_scopes',
      'teams',
    ])
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
    expect(report.externalInboundDependencies).toEqual([])
    // The regenerated baseline creates every tenant foreign key VALIDATED.
    // The 182-migration journal left ten of them NOT VALID, which is the
    // repair debt this report used to carry.
    expect(report.foreignKeys.filter(({ validated }) => !validated)).toEqual([])
    expect(report.blockers).not.toContain('unvalidated_foreign_keys_require_repair')
    expect(report.schemaContractionCandidate).toBe(false)
  })

  it('captures cross-schema inbound and outbound dependencies', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const fixtureSchema = `people_team_inventory_${suffix}`
    const outboundConstraint = `teams_property_external_${suffix}`

    try {
      await lease.pool.query(`CREATE SCHEMA "${fixtureSchema}"`)
      await lease.pool.query(`
        CREATE TABLE "${fixtureSchema}".team_consumers (
          team_id uuid REFERENCES public.teams(id)
        )
      `)
      await lease.pool.query(`
        CREATE TABLE "${fixtureSchema}".property_targets (
          id uuid PRIMARY KEY
        )
      `)
      await lease.pool.query(`
        INSERT INTO "${fixtureSchema}".property_targets (id)
        SELECT DISTINCT property_id FROM public.teams
      `)
      await lease.pool.query(`
        ALTER TABLE public.teams
        ADD CONSTRAINT "${outboundConstraint}"
        FOREIGN KEY (property_id)
        REFERENCES "${fixtureSchema}".property_targets(id)
      `)

      const report = await readLegacyPeopleTeamInventory(
        db,
        new Date('2026-08-28T00:00:00.000Z'),
      )

      expect(report.externalInboundDependencies).toContainEqual(
        expect.objectContaining({
          sourceSchema: fixtureSchema,
          sourceTable: 'team_consumers',
          targetSchema: 'public',
          targetTable: 'teams',
        }),
      )
      expect(report.externalOutboundDependencies).toContainEqual(
        expect.objectContaining({
          sourceSchema: 'public',
          sourceTable: 'teams',
          targetSchema: fixtureSchema,
          targetTable: 'property_targets',
        }),
      )
      expect(report.blockers).toContain(
        'external_foreign_key_dependencies_require_disposition',
      )
    } finally {
      await lease.pool.query(
        `ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS "${outboundConstraint}"`,
      )
      await lease.pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`)
    }
  })
})
