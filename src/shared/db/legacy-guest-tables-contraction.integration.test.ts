import { expect, it } from 'vitest'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0157_drop_legacy_ratings_feedback'

it(
  'refuses to drop the legacy guest tables while either holds a row, then drops feedback before ratings',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ client, migrationIndex, migrateThrough }) => {
        await migrateThrough(migrationIndex)

        const tables = async () =>
          (
            await client.query<{ table_name: string }>(
              `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name IN ('ratings', 'feedback')
           ORDER BY table_name`,
            )
          ).rows.map(({ table_name }) => table_name)
        expect(await tables()).toEqual(['feedback', 'ratings'])

        const portal = (
          await client.query<{
            id: string
            organization_id: string
            property_id: string
          }>('SELECT id, organization_id, property_id FROM portals LIMIT 1')
        ).rows[0]!
        await client.query('DELETE FROM feedback')
        await client.query('DELETE FROM ratings')

        await client.query(
          `INSERT INTO ratings (organization_id, portal_id, property_id, value, source)
       VALUES ($1, $2, $3, 5, 'qr')`,
          [portal.organization_id, portal.id, portal.property_id],
        )
        await expect(migrateThrough(migrationIndex + 1)).rejects.toThrow(
          /ratings holds 1 rows and feedback holds 0 rows/,
        )
        expect(await tables()).toEqual(['feedback', 'ratings'])
        await client.query('DELETE FROM ratings')

        await client.query(
          `INSERT INTO feedback (organization_id, portal_id, property_id, comment, source)
       VALUES ($1, $2, $3, 'kept', 'qr')`,
          [portal.organization_id, portal.id, portal.property_id],
        )
        await expect(migrateThrough(migrationIndex + 1)).rejects.toThrow(
          /ratings holds 0 rows and feedback holds 1 rows/,
        )
        expect(await tables()).toEqual(['feedback', 'ratings'])
        await client.query('DELETE FROM feedback')

        await migrateThrough(migrationIndex + 1)
        expect(await tables()).toEqual([])
        await migrateJournal(client, 'drizzle')
        expect(await tables()).toEqual([])
      },
    ),
  150_000,
)
