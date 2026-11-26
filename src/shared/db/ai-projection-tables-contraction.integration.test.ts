import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0129_drop_retired_ai_projection_tables'

const DROPPED_TABLES = [
  'ai_property_trend_scheduler_heads',
  'ai_property_trend_schedules',
  'ai_property_trend_outcomes',
  'ai_property_daily_aggregates',
  'ai_property_daily_aspect_aggregates',
  'ai_property_aggregate_contribution_aspects',
  'ai_review_analysis_aspects',
  'ai_property_review_population_daily',
] as const

const KEPT_TABLES = [
  'ai_review_analyses',
  'ai_review_analysis_mentions',
  'ai_property_aggregate_contributions',
  'ai_property_aggregate_contribution_mentions',
  'ai_draft_measurements',
  'ai_draft_measurement_links',
] as const

it(
  'refuses to drop the retired AI tables while one holds a row, then drops them once empty',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, entries, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        await migrateThrough(migrationIndex)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

        const property = (
          await client.query<{ id: string; organization_id: string }>(
            'SELECT id, organization_id FROM properties ORDER BY id LIMIT 1',
          )
        ).rows[0]!
        await client.query(
          `INSERT INTO ai_property_review_population_daily (
         organization_id, property_id, local_date, source_epoch, property_profile_version,
         calendar_profile_version, review_count, text_review_count, rating_1_count,
         rating_2_count, rating_3_count, rating_4_count, rating_5_count,
         population_revision, updated_at
       ) VALUES ($1, $2, '2026-09-07', 0, 1, 'property-calendar-v1', 5, 2, 1, 1, 1, 1, 1, 1, now())`,
          [property.organization_id, property.id],
        )

        const customerWithRow = await upgradeCustomerRows(pool)

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
        const days = async () =>
          (
            await client.query(
              'SELECT * FROM ai_property_review_population_daily ORDER BY local_date',
            )
          ).rows
        const heads = async () =>
          (
            await client.query(
              'SELECT * FROM ai_property_trend_scheduler_heads ORDER BY scheduler_key',
            )
          ).rows
        const beforeTables = await tables()
        const beforeJournal = await journal()
        const beforeDays = await days()
        const beforeHeads = await heads()
        expect(beforeDays).toHaveLength(1)
        expect(beforeHeads.length).toBeLessThanOrEqual(1)
        for (const table of [...DROPPED_TABLES, ...KEPT_TABLES]) {
          expect(beforeTables).toContain(table)
        }

        await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(
          'Cannot drop ai_property_review_population_daily: 1 rows remain',
        )
        expect(await tables()).toEqual(beforeTables)
        expect(await days()).toEqual(beforeDays)
        expect(await heads()).toEqual(beforeHeads)
        expect(await journal()).toEqual(beforeJournal)
        expect(await upgradeCustomerRows(pool)).toEqual(customerWithRow)

        await client.query('DELETE FROM ai_property_review_population_daily')
        await migrateJournal(client, 'drizzle')
        const after = await tables()
        for (const table of DROPPED_TABLES) expect(after).not.toContain(table)
        for (const table of KEPT_TABLES) expect(after).toContain(table)
        const applied = await journal()
        expect(applied).toHaveLength(entries.length)
        expect(applied[migrationIndex]).toMatchObject({
          created_at: String(entries[migrationIndex]!.when),
          is_contract: true,
        })
        await migrateJournal(client, 'drizzle')
        expect(await journal()).toEqual(applied)
      },
    ),
  150_000,
)
