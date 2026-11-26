import { expect, it } from 'vitest'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0160_drop_inbox_handling_cycle_heads'
const TABLE = 'inbox_handling_cycle_heads'

it(
  'drops the retired Handling Cycle head table with its rows, and leaves the Inbox items alone',
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
        const items = async () =>
          Number(
            (await client.query<{ n: string }>('SELECT count(*) AS n FROM inbox_items'))
              .rows[0]!.n,
          )
        expect(await present()).toBe(true)
        const itemsBefore = await items()
        expect(itemsBefore).toBeGreaterThan(0)

        await migrateThrough(migrationIndex + 1)
        expect(await present()).toBe(false)
        expect(await items()).toBe(itemsBefore)

        // Nothing is left that names the table, and the full journal applies again.
        const leftovers = await client.query(
          `SELECT conname FROM pg_catalog.pg_constraint WHERE conname LIKE $1
       UNION ALL
       SELECT indexname FROM pg_catalog.pg_indexes WHERE indexname LIKE $1`,
          [`${TABLE}%`],
        )
        expect(leftovers.rows).toEqual([])
        await migrateJournal(client, 'drizzle')
        expect(await present()).toBe(false)
      },
    ),
  150_000,
)
