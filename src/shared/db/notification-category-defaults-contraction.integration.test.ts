import { expect, it } from 'vitest'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0161_drop_notification_category_defaults'
const TABLE = 'notification_category_defaults'

it(
  'drops the retired category defaults table with its CHECKs, index and key, and leaves the preference rows alone',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ client, migrationIndex, migrateThrough }) => {
        await migrateThrough(migrationIndex)

        const present = async () =>
          (
            await client.query(
              `SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1`,
              [TABLE],
            )
          ).rowCount === 1
        const namedAfterTable = async () =>
          (
            await client.query<{ name: string }>(
              `SELECT conname AS name FROM pg_catalog.pg_constraint WHERE conname LIKE $1
       UNION ALL
       SELECT indexname AS name FROM pg_catalog.pg_indexes WHERE indexname LIKE $1
       ORDER BY name`,
              [`${TABLE}%`],
            )
          ).rows.map((row) => row.name)
        const preferences = async () =>
          Number(
            (
              await client.query<{ n: string }>(
                'SELECT count(*) AS n FROM notification_preferences',
              )
            ).rows[0]!.n,
          )
        expect(await present()).toBe(true)
        expect(await namedAfterTable()).toEqual(
          expect.arrayContaining([
            `${TABLE}_pkey`,
            `${TABLE}_scope_unique`,
            `${TABLE}_channel_valid`,
            `${TABLE}_required_enabled`,
          ]),
        )
        const preferencesBefore = await preferences()

        await migrateThrough(migrationIndex + 1)
        expect(await present()).toBe(false)
        expect(await preferences()).toBe(preferencesBefore)

        // Nothing is left that names the table, and the full journal applies again.
        expect(await namedAfterTable()).toEqual([])
        await migrateJournal(client, 'drizzle')
        expect(await present()).toBe(false)
      },
    ),
  150_000,
)
