import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { restorePopulatedUpgradeFixture } from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'

const CONTRACTION = '0157_drop_legacy_ratings_feedback'

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

it('refuses to drop the legacy guest tables while either holds a row, then drops feedback before ratings', async () => {
  databaseName = `test_legacy_guest_drop_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${databaseName}`
  target = await acquireTestLease(url.toString())
  restorePopulatedUpgradeFixture(url.toString())
  const { pool } = target
  const history = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const contractionIndex = history.entries.findIndex(({ tag }) => tag === CONTRACTION)
  expect(contractionIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
  historyFolder = mkdtempSync(join(tmpdir(), 'legacy-guest-drop-'))
  cpSync('drizzle', historyFolder, { recursive: true })
  const historyPath = join(historyFolder, 'meta/_journal.json')
  const through = (count: number) =>
    writeFileSync(
      historyPath,
      JSON.stringify({ ...history, entries: history.entries.slice(0, count) }),
    )
  const client = await pool.connect()
  try {
    through(contractionIndex)
    await migrateJournal(client, historyFolder)

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
      await client.query<{ id: string; organization_id: string; property_id: string }>(
        'SELECT id, organization_id, property_id FROM portals LIMIT 1',
      )
    ).rows[0]!
    await client.query('DELETE FROM feedback')
    await client.query('DELETE FROM ratings')
    through(contractionIndex + 1)

    await client.query(
      `INSERT INTO ratings (organization_id, portal_id, property_id, value, source)
       VALUES ($1, $2, $3, 5, 'qr')`,
      [portal.organization_id, portal.id, portal.property_id],
    )
    await expect(migrateJournal(client, historyFolder)).rejects.toThrow(
      /ratings holds 1 rows and feedback holds 0 rows/,
    )
    expect(await tables()).toEqual(['feedback', 'ratings'])
    await client.query('DELETE FROM ratings')

    await client.query(
      `INSERT INTO feedback (organization_id, portal_id, property_id, comment, source)
       VALUES ($1, $2, $3, 'kept', 'qr')`,
      [portal.organization_id, portal.id, portal.property_id],
    )
    await expect(migrateJournal(client, historyFolder)).rejects.toThrow(
      /ratings holds 0 rows and feedback holds 1 rows/,
    )
    expect(await tables()).toEqual(['feedback', 'ratings'])
    await client.query('DELETE FROM feedback')

    await migrateJournal(client, historyFolder)
    expect(await tables()).toEqual([])
    await migrateJournal(client, 'drizzle')
    expect(await tables()).toEqual([])
  } finally {
    client.release()
  }
}, 150_000)
