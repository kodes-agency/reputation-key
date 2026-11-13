import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { testEnvironment } from '#/shared/testing/test-environment'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildConcurrentIndex } from './concurrent-index-migration'
import { journalConcurrentIndex } from './journal-concurrent-index'
import { migrateJournal } from './migrate-journal.server'
import { readMigrationJournal } from './migration-journal-order'
import { readStructure } from './structure.server'

// A database deployed before the journal owned Better Auth's tables and the
// concurrent indexes: the pinned runtime created the auth tables, the journal
// stopped at 0132 and a separate step built the indexes. The deploy must record
// those files without recreating, dropping or rebuilding anything.

const ADOPTED_FROM = 133
const AUTH_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
]

let maintenance: TestLease
let name: string
let url: string
let lease: TestLease
let folder: string

const entries = readMigrationJournal()
const indexes = entries.flatMap(({ idx, tag }) => {
  if (idx < ADOPTED_FROM) return []
  const spec = journalConcurrentIndex(
    readFileSync(new URL(`../../../drizzle/${tag}.sql`, import.meta.url), 'utf8'),
  )
  return spec ? [spec] : []
})

beforeAll(async () => {
  maintenance = await acquireTestLease(getEnv().DATABASE_URL)
  name = `test_adoption_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${name}"`)
  const target = new URL(getEnv().DATABASE_URL)
  target.pathname = `/${name}`
  url = target.toString()
  lease = await acquireTestLease(url)
  folder = mkdtempSync(join(tmpdir(), 'journal-adoption-'))
  cpSync('drizzle', folder, { recursive: true })
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { idx: number }[]
  }
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter(({ idx }) => idx < ADOPTED_FROM),
    }),
  )
}, 60_000)

afterAll(async () => {
  await lease?.release()
  if (name) await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await maintenance?.release()
  if (folder) rmSync(folder, { recursive: true, force: true })
})

function run(script: string, env: Record<string, string>) {
  return execFileSync(process.execPath, ['--import', 'tsx', script], {
    env: { ...process.env, ...testEnvironment(), DATABASE_URL: url, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  }).toString('utf8')
}

function deploy() {
  return run('scripts/migrate-deploy.ts', {
    DATABASE_URL_POOLER: url,
    DEPLOY_MIGRATE: '1',
    REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: `v1:${'cd'.repeat(32)}`,
  })
}

async function objectIds() {
  const { rows } = await lease.pool.query<{ relname: string; oid: string }>(
    'SELECT relname, oid::text FROM pg_class WHERE relname = ANY($1) ORDER BY relname',
    [[...AUTH_TABLES, ...indexes.map((spec) => spec.name)]],
  )
  return rows
}

it('adopts runtime-created auth tables and existing indexes without rebuilding them', async () => {
  expect(indexes).toHaveLength(17)
  run('scripts/better-auth-schema.ts', {})
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await migrateJournal(client, folder)
    for (const spec of indexes) {
      expect((await buildConcurrentIndex(client, spec)).ok, spec.name).toBe(true)
    }
  } finally {
    await client.end()
  }
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ('adopted-user', 'Adopted', 'adopted@example.com', true)`,
  )
  const before = await objectIds()
  expect(before).toHaveLength(AUTH_TABLES.length + indexes.length)

  const output = deploy()

  expect(output).toContain('"missingTables":[],"missingColumns":[]')
  expect(await objectIds()).toEqual(before)
  expect(
    (await lease.pool.query('SELECT email FROM "user" WHERE id = $1', ['adopted-user']))
      .rows,
  ).toEqual([{ email: 'adopted@example.com' }])
  const applied = await lease.pool.query<{ is_contract: boolean }>(
    'SELECT is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
  )
  expect(applied.rows).toHaveLength(entries.length)
  // Expands only: the previous image stays ready after this deploy.
  expect(applied.rows.slice(ADOPTED_FROM).every(({ is_contract }) => !is_contract)).toBe(
    true,
  )
  expect(
    await lease.pool.query('SELECT to_regclass(\'public."organizationRole"\') AS role'),
  ).toMatchObject({ rows: [{ role: null }] })
  expect(await readStructure(url)).toBe(
    readFileSync(new URL('./structure.sql', import.meta.url), 'utf8'),
  )

  deploy()
  expect(await objectIds()).toEqual(before)
}, 300_000)
