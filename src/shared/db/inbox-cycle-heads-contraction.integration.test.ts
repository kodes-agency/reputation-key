import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { restorePopulatedUpgradeFixture } from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'
import { readMigrationJournal } from './migration-journal-order'

const CONTRACTION = '0160_drop_inbox_handling_cycle_heads'
const TABLE = 'inbox_handling_cycle_heads'

let maintenance: TestLease
let target: TestLease | undefined
let databaseName: string | undefined
let historyFolder: string | undefined

beforeAll(async () => {
  maintenance = await acquireTestLease(getEnv().DATABASE_URL)
})

afterAll(async () => {
  await target?.release()
  if (databaseName) await maintenance.pool.query(`DROP DATABASE "${databaseName}"`)
  await maintenance?.release()
  if (historyFolder) rmSync(historyFolder, { recursive: true, force: true })
})

it('drops the retired Handling Cycle head table with its rows, and leaves the Inbox items alone', async () => {
  databaseName = `test_cycle_heads_drop_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${databaseName}`
  target = await acquireTestLease(url.toString())
  restorePopulatedUpgradeFixture(url.toString())
  const { pool } = target
  const entries = readMigrationJournal()
  const contractionIndex = entries.findIndex(({ tag }) => tag === CONTRACTION)
  expect(contractionIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
  historyFolder = mkdtempSync(join(tmpdir(), 'cycle-heads-drop-'))
  cpSync('drizzle', historyFolder, { recursive: true })
  const historyPath = join(historyFolder, 'meta/_journal.json')
  const through = (count: number) =>
    writeFileSync(
      historyPath,
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: entries.slice(0, count),
      }),
    )
  const client = await pool.connect()
  try {
    through(contractionIndex)
    await migrateJournal(client, historyFolder)

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

    through(contractionIndex + 1)
    await migrateJournal(client, historyFolder)
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
  } finally {
    client.release()
  }
}, 150_000)
