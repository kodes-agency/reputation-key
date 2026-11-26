import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0128_drop_retired_reporting_tables'
const TABLES = [
  'setup_checklist_milestones',
  'portal_metric_lifetime_aggregates',
] as const
const RETAINED = [
  'goal_subject_assignments',
  'metric_readings',
  'portal_goal_prompt_deferrals',
  'property_rating_goal_deferrals',
  'property_rating_goals',
] as const

it(
  'refuses while a retired reading or checklist milestone remains, then drops only the two retired tables',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, entries, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        await migrateThrough(migrationIndex)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

        const portal = (
          await client.query<{
            id: string
            organization_id: string
            property_id: string
          }>('SELECT id, organization_id, property_id FROM portals ORDER BY id LIMIT 1')
        ).rows[0]!
        const readingId = randomUUID()
        const now = new Date()
        await client.query(
          `INSERT INTO portal_metric_lifetime_aggregates
         (organization_id, property_id, portal_id, qualified_scan_count)
       VALUES ($1, $2, $3, 6)`,
          [portal.organization_id, portal.property_id, portal.id],
        )
        await client.query(
          `INSERT INTO metric_readings (
         id, organization_id, property_id, portal_id, metric_key, value,
         definition_version_id, source_event_id, source_policy, exact_value,
         sample_count, attribution_quality, recorded_at, event_at,
         property_local_date, data_quality, retention_class
       ) VALUES ($1::uuid, $2, $3::uuid, NULL, 'property.review', 5::real,
                 '11111111-1111-4111-8111-111111111205', $4,
                 'google_property_derivative', 5::numeric, 1, 'exact', $5, $5,
                 '2026-11-01', 'exact', 'guest_gateway_metric')`,
          [
            readingId,
            portal.organization_id,
            portal.property_id,
            `contract-${readingId}`,
            now,
          ],
        )

        const tables = async () =>
          (
            await client.query<{ tablename: string }>(
              `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
            )
          ).rows.map(({ tablename }) => tablename)
        const journal = async () =>
          (
            await client.query(
              'SELECT hash, created_at, is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
            )
          ).rows
        const readings = async () =>
          (await client.query('SELECT * FROM metric_readings ORDER BY id')).rows
        const lifetime = async () =>
          (
            await client.query(
              'SELECT * FROM portal_metric_lifetime_aggregates ORDER BY id',
            )
          ).rows
        const milestones = async () =>
          (
            await client.query(
              'SELECT * FROM setup_checklist_milestones ORDER BY organization_id, step',
            )
          ).rows
        const beforeTables = await tables()
        const beforeJournal = await journal()

        const expectRefusal = async (message: string) => {
          const beforeReadings = await readings()
          const beforeLifetime = await lifetime()
          const beforeMilestones = await milestones()
          await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(message)
          expect(await tables()).toEqual(beforeTables)
          expect(await readings()).toEqual(beforeReadings)
          expect(await lifetime()).toEqual(beforeLifetime)
          expect(await milestones()).toEqual(beforeMilestones)
          expect(await journal()).toEqual(beforeJournal)
          expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        }

        await expectRefusal('metric_readings still holds 1 rows')
        await client.query('DELETE FROM metric_readings WHERE id = $1', [readingId])

        await client.query(
          `INSERT INTO setup_checklist_milestones (organization_id, step, first_completed_at)
       VALUES ($1, 'published_portal', $2)`,
          [portal.organization_id, now],
        )
        await expectRefusal('Cannot drop setup_checklist_milestones: 1 rows remain')
        await client.query('DELETE FROM setup_checklist_milestones')

        const retainedBefore: Record<string, unknown[]> = {}
        for (const table of RETAINED) {
          // Fixed names: the tables the contraction must leave alone.
          retainedBefore[table] = (await client.query(`SELECT * FROM ${table}`)).rows
        }

        // Apply only the contraction, so later additive migrations cannot change the table set.
        await migrateThrough(migrationIndex + 1)
        expect(await tables()).toEqual(
          beforeTables.filter((table) => !TABLES.some((removed) => removed === table)),
        )
        for (const table of RETAINED) {
          expect((await client.query(`SELECT * FROM ${table}`)).rows).toEqual(
            retainedBefore[table],
          )
        }
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        const applied = await journal()
        expect(applied).toHaveLength(migrationIndex + 1)
        expect(applied[migrationIndex]).toMatchObject({
          created_at: String(entries[migrationIndex]!.when),
          is_contract: true,
        })
        await migrateThrough(migrationIndex + 1)
        expect(await journal()).toEqual(applied)
      },
    ),
  150_000,
)
