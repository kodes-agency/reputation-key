import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  restorePopulatedUpgradeFixture,
  upgradeCustomerRows,
} from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'

const CONTRACTION = '0121_drop_old_reply_library_tables'
const TABLES = ['property_reply_templates', 'property_reply_profiles'] as const

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

it('refuses to drop a library table holding more than one row, then drops both tables holding one row each', async () => {
  databaseName = `test_reply_library_contract_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${databaseName}`
  target = await acquireTestLease(url.toString())
  restorePopulatedUpgradeFixture(url.toString())
  const { pool } = target
  const customerBeforeUpgrade = await upgradeCustomerRows(pool)

  // Stop immediately before the real contraction, using the deployment runner.
  const history = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const contractionIndex = history.entries.findIndex(({ tag }) => tag === CONTRACTION)
  expect(contractionIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
  historyFolder = mkdtempSync(join(tmpdir(), 'reply-library-contract-'))
  cpSync('drizzle', historyFolder, { recursive: true })
  writeFileSync(
    join(historyFolder, 'meta/_journal.json'),
    JSON.stringify({ ...history, entries: history.entries.slice(0, contractionIndex) }),
  )
  const client = await pool.connect()
  try {
    await migrateJournal(client, historyFolder)
    expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

    const property = (
      await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM properties ORDER BY id LIMIT 1',
      )
    ).rows[0]!
    const insertTemplate = (title: string) =>
      client.query(
        `INSERT INTO property_reply_templates (
          organization_id, property_id, title, rating_min, rating_max, has_text,
          language_tag, body, updated_by
        ) VALUES ($1, $2, $3, 5, 5, true, 'en-Latn', 'Thank you', 'contract-test')`,
        [property.organization_id, property.id, title],
      )
    const insertProfile = () =>
      client.query(
        `INSERT INTO property_reply_profiles (
          organization_id, property_id, greeting, sign_off_positive,
          sign_off_negative, updated_by
        ) VALUES ($1, $2, 'Hello', 'Warm regards', 'Sincerely', 'contract-test')`,
        [property.organization_id, property.id],
      )
    await insertTemplate('first')
    await insertProfile()

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
    const libraryRows = async () => {
      const snapshots: unknown[][] = []
      for (const table of TABLES) {
        // These fixed names are the two objects authorized for contraction.
        const result = await client.query(`SELECT * FROM ${table} ORDER BY id`)
        snapshots.push(result.rows)
      }
      return snapshots
    }
    const beforeTables = await tables()
    const beforeJournal = await journal()

    // A second row in either table stops the whole migration with the count.
    const extraRows = {
      property_reply_templates: () => insertTemplate('second'),
      property_reply_profiles: async () => {
        // One profile per Property, so the extra row belongs to another Property.
        await client.query(
          `INSERT INTO property_reply_profiles (
            organization_id, property_id, greeting, sign_off_positive,
            sign_off_negative, updated_by
          ) SELECT organization_id, id, 'Hello', 'Warm regards', 'Sincerely', 'contract-test'
          FROM properties WHERE id <> $1 ORDER BY id LIMIT 1`,
          [property.id],
        )
      },
    }
    for (const table of TABLES) {
      await extraRows[table]()
      const beforeRows = await libraryRows()
      await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(
        `Cannot drop ${table}: table holds 2 rows`,
      )
      expect(await tables()).toEqual(beforeTables)
      expect(await libraryRows()).toEqual(beforeRows)
      expect(await journal()).toEqual(beforeJournal)
      expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
      await client.query(
        `DELETE FROM ${table} WHERE id = (SELECT id FROM ${table} ORDER BY created_at DESC, id DESC LIMIT 1)`,
      )
    }

    // Apply only the contraction, so later additive migrations cannot change the table set.
    writeFileSync(
      join(historyFolder, 'meta/_journal.json'),
      JSON.stringify({
        ...history,
        entries: history.entries.slice(0, contractionIndex + 1),
      }),
    )
    await migrateJournal(client, historyFolder)
    expect(await tables()).toEqual(
      beforeTables.filter((table) => !TABLES.some((removed) => removed === table)),
    )
    expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
    expect(await journal()).toHaveLength(contractionIndex + 1)

    await migrateJournal(client, 'drizzle')
    expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
    const applied = await journal()
    expect(applied).toHaveLength(history.entries.length)
    expect(applied[contractionIndex]).toMatchObject({
      created_at: String(history.entries[contractionIndex]!.when),
      is_contract: true,
    })
    await migrateJournal(client, 'drizzle')
    expect(await journal()).toEqual(applied)
  } finally {
    client.release()
  }
}, 150_000)
