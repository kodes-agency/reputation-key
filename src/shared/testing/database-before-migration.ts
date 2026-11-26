import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PoolClient } from 'pg'
import { expect } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease } from './test-environment-lease'
// eslint-disable-next-line boundaries/dependencies -- the populated-upgrade fixture is owned by the CI scripts
import { restorePopulatedUpgradeFixture } from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from '#/shared/db/migrate-journal.server'
import type { MigrationJournalEntry } from '#/shared/db/migration-journal-order'

type Pool = Awaited<ReturnType<typeof acquireTestLease>>['pool']

export type DatabaseBeforeMigration = Readonly<{
  pool: Pool
  client: PoolClient
  entries: readonly MigrationJournalEntry[]
  /** Journal position of the migration under test. */
  migrationIndex: number
  /** Applies the real journal runner to the first `count` entries of the journal. */
  migrateThrough: (count: number) => Promise<void>
}>

/**
 * Restores the populated upgrade fixture into a throwaway database and hands
 * the test a client whose journal has not yet reached `tag`. The test drives
 * the real journal runner with `migrateThrough`, so it exercises the deployed
 * migration SQL on populated data. The database and the journal folder are
 * removed afterwards.
 */
export async function withDatabaseBeforeMigration(
  tag: string,
  run: (database: DatabaseBeforeMigration) => Promise<void>,
): Promise<void> {
  const maintenance = await acquireTestLease(getEnv().DATABASE_URL)
  const databaseName = `test_migration_${randomUUID().replaceAll('-', '')}`
  let journalFolder: string | undefined
  let target: Awaited<ReturnType<typeof acquireTestLease>> | undefined
  try {
    await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
    const url = new URL(getEnv().DATABASE_URL)
    url.pathname = `/${databaseName}`
    target = await acquireTestLease(url.toString())
    restorePopulatedUpgradeFixture(url.toString())

    const history = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: MigrationJournalEntry[]
    }
    const migrationIndex = history.entries.findIndex((entry) => entry.tag === tag)
    // A migration already inside the fixture baseline would prove nothing.
    expect(migrationIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
    const folder = mkdtempSync(join(tmpdir(), 'migration-journal-'))
    journalFolder = folder
    cpSync('drizzle', folder, { recursive: true })

    const client = await target.pool.connect()
    try {
      await run({
        pool: target.pool,
        client,
        entries: history.entries,
        migrationIndex,
        migrateThrough: async (count) => {
          writeFileSync(
            join(folder, 'meta/_journal.json'),
            JSON.stringify({ ...history, entries: history.entries.slice(0, count) }),
          )
          await migrateJournal(client, folder)
        },
      })
    } finally {
      client.release()
    }
  } finally {
    await target?.release()
    await maintenance.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await maintenance.release()
    if (journalFolder) rmSync(journalFolder, { recursive: true, force: true })
  }
}
