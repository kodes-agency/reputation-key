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

const CONTRACTION = '0126_drop_portal_group_members'

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

it('refuses to drop portal_group_members while it holds a row, then drops it once empty', async () => {
  databaseName = `test_portal_group_members_contract_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${databaseName}`
  target = await acquireTestLease(url.toString())
  restorePopulatedUpgradeFixture(url.toString())
  const { pool } = target
  const customerBeforeUpgrade = await upgradeCustomerRows(pool)

  const history = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const contractionIndex = history.entries.findIndex(({ tag }) => tag === CONTRACTION)
  expect(contractionIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
  historyFolder = mkdtempSync(join(tmpdir(), 'portal-group-members-contract-'))
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
    const portalId = randomUUID()
    const groupId = randomUUID()
    await client.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                            publication_state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Front Desk', 'contract-front-desk', 'draft', now(), now())`,
      [portalId, property.organization_id, property.id, property.id],
    )
    await client.query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name, sort_key,
                                  created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'Ground Floor', 'a', 'contract-test', now(), now())`,
      [groupId, property.organization_id, property.id],
    )
    await client.query(
      `INSERT INTO portal_group_members (id, portal_group_id, portal_id, organization_id, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [randomUUID(), groupId, portalId, property.organization_id],
    )

    const customerWithMember = await upgradeCustomerRows(pool)

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
    const members = async () =>
      (await client.query('SELECT * FROM portal_group_members ORDER BY id')).rows
    const beforeTables = await tables()
    const beforeJournal = await journal()
    const beforeMembers = await members()
    expect(beforeMembers).toHaveLength(1)

    await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(
      'Cannot drop portal_group_members: 1 rows remain',
    )
    expect(await tables()).toEqual(beforeTables)
    expect(await members()).toEqual(beforeMembers)
    expect(await journal()).toEqual(beforeJournal)
    expect(await upgradeCustomerRows(pool)).toEqual(customerWithMember)

    await client.query('DELETE FROM portal_group_members')
    await migrateJournal(client, 'drizzle')
    expect(await tables()).not.toContain('portal_group_members')
    expect(await tables()).toContain('portal_group_memberships')
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
