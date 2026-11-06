import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  restorePopulatedUpgradeFixture,
  upgradeCustomerRows,
} from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'
import { readStructure } from './structure.server'

let maintenance: TestLease
const databases: { name: string; url: string; lease: TestLease }[] = []
const folders: string[] = []

beforeAll(async () => {
  maintenance = await acquireTestLease(getEnv().DATABASE_URL)
})

afterAll(async () => {
  for (const { name, lease } of databases) {
    await lease.release()
    await maintenance.pool.query(`DROP DATABASE "${name}"`)
  }
  await maintenance?.release()
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

async function database(populated = true) {
  const name = `test_upgrade_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${name}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${name}`
  const lease = await acquireTestLease(url.toString())
  const target = { name, url: url.toString(), lease }
  databases.push(target)
  if (populated) {
    restorePopulatedUpgradeFixture(url.toString())
    expect(
      (await lease.pool.query('SELECT id FROM organization ORDER BY id')).rows,
    ).toEqual(manifest.organizationIds.map((id) => ({ id })))
    expect((await journal(lease)).length).toBe(manifest.appliedMigrations)
  }
  return target
}

async function journal(lease: TestLease) {
  return (
    await lease.pool.query(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
    )
  ).rows
}

function customerRows(lease: TestLease) {
  return upgradeCustomerRows(lease.pool)
}

function deploy(url: string) {
  // Execute the supported command with the canonical test environment. The
  // fixture predates key initialization, so this run supplies its one-run key.
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-deploy.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: url,
      DEPLOY_MIGRATE: '1',
      REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: `v1:${'cd'.repeat(32)}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })
}

it('loads the captured dump carrying restrict and unrestrict commands', async () => {
  const sql = gunzipSync(
    readFileSync('test-fixtures/populated-upgrade/two-tenant.sql.gz'),
  ).toString('utf8')
  expect(/^\\restrict /m.test(sql)).toBe(true)
  expect(/^\\unrestrict /m.test(sql)).toBe(true)
  const target = await database()
  // The captured scenario holds no guest response; the counts are the fixture's.
  expect((await customerRows(target.lease)).map((rows) => rows.length)).toEqual([
    2, 3, 3, 13, 3, 0,
  ])
})

it('upgrades the captured tenants through pending deploy migrations and converges on reapply', async () => {
  const target = await database()
  const before = await customerRows(target.lease)
  deploy(target.url)
  expect(await customerRows(target.lease)).toEqual(before)
  const applied = await journal(target.lease)
  const expected = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: unknown[]
  }
  expect(applied).toHaveLength(expected.entries.length)
  const structure = await readStructure(target.url)
  deploy(target.url)
  expect(await journal(target.lease)).toEqual(applied)
  expect(await customerRows(target.lease)).toEqual(before)
  expect(await readStructure(target.url)).toBe(structure)
}, 150_000)

it('resumes after a committed pending file loses its connection, matching an uninterrupted upgrade', async () => {
  const clean = await database()
  const recovered = await database()
  const before = await customerRows(recovered.lease)
  deploy(clean.url)
  const client = await recovered.lease.pool.connect()
  let interrupted = false
  const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
    .rows[0]!.pid
  // Terminating a pg client emits an error independently of its pending query.
  client.on('error', () => {})
  try {
    await expect(
      migrateJournal(
        {
          query: async (text, values) => {
            const result = await client.query(text, values)
            if (text === 'COMMIT' && !interrupted) {
              interrupted = true
              await maintenance.pool.query('SELECT pg_terminate_backend($1)', [pid])
              throw new Error('Upgrade connection interrupted after commit')
            }
            return result
          },
        },
        'drizzle',
      ),
    ).rejects.toThrow('Upgrade connection interrupted after commit')
    expect(interrupted).toBe(true)
    expect((await journal(recovered.lease)).length).toBe(manifest.appliedMigrations + 1)
  } finally {
    client.release(true)
  }
  deploy(recovered.url)
  expect(await journal(recovered.lease)).toEqual(await journal(clean.lease))
  expect(await customerRows(recovered.lease)).toEqual(before)
  expect(await readStructure(recovered.url)).toBe(await readStructure(clean.url))
  const applied = await journal(recovered.lease)
  deploy(recovered.url)
  expect(await journal(recovered.lease)).toEqual(applied)
  expect(await customerRows(recovered.lease)).toEqual(before)
}, 180_000)

it('rejects a planted migration that passes on empty rows but breaks captured tenant data', async () => {
  const target = await database()
  const empty = await database(false)
  const before = await customerRows(target.lease)
  const folder = mkdtempSync(join(tmpdir(), 'populated-upgrade-'))
  folders.push(folder)
  cpSync('drizzle', folder, { recursive: true })
  const path = join(folder, 'meta/_journal.json')
  const history = JSON.parse(readFileSync(path, 'utf8')) as {
    entries: {
      idx: number
      tag: string
      when: number
      version: string
      breakpoints: boolean
    }[]
  }
  history.entries.push({
    idx: history.entries.length,
    tag: 'populated_fault',
    when: history.entries.at(-1)!.when + 100_000_000,
    version: '7',
    breakpoints: true,
  })
  writeFileSync(path, JSON.stringify(history))
  const fault = `-- migrate:contract ${'a'.repeat(40)}\nALTER TABLE properties ADD COLUMN required_upgrade_value text NOT NULL;`
  writeFileSync(join(folder, 'populated_fault.sql'), fault)
  const client = await target.lease.pool.connect()
  try {
    await expect(migrateJournal(client, folder)).rejects.toMatchObject({ code: '23502' })
  } finally {
    client.release()
  }
  // The same DDL succeeds without rows; an empty-schema-only gate misses it.
  await empty.lease.pool.query('CREATE TABLE properties (id text PRIMARY KEY)')
  await empty.lease.pool.query(fault)
  expect(await customerRows(target.lease)).toEqual(before)
  expect((await journal(target.lease)).length).toBe(history.entries.length - 1)
}, 90_000)
