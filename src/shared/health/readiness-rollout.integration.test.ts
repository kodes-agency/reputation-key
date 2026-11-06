import { createHash, randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { migrateJournal } from '#/shared/db/migrate-journal.server'
import {
  previousJournal,
  previousRevisionReadiness,
} from './previous-revision-readiness.test-fixture'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('#/shared/db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/db/pool')>()),
  getPool: () => ({ query: mocks.query }),
}))
import { isMigrationJournalMatched } from './readiness'

let maintenance: TestLease
let lease: TestLease
let database: string
let folder: string

beforeAll(async () => {
  maintenance = await acquireTestLease(getEnv().DATABASE_URL)
  database = `test_readiness_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${database}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${database}`
  lease = await acquireTestLease(url.toString())
  folder = mkdtempSync(join(tmpdir(), 'readiness-rollout-'))
  cpSync(join(process.cwd(), 'drizzle'), folder, { recursive: true })
  mocks.query.mockImplementation((sql: string) => lease.pool.query(sql))
})

afterAll(async () => {
  await lease?.release()
  if (database) await maintenance.pool.query(`DROP DATABASE "${database}"`)
  await maintenance?.release()
  if (folder) rmSync(folder, { recursive: true })
})

function appendMigration(tag: string, sql: string): void {
  const path = join(folder, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(path, 'utf8')) as typeof previousJournal
  journal.entries.push({
    idx: journal.entries.length,
    tag,
    when: journal.entries.at(-1)!.when + 100_000_000,
    version: '7',
    breakpoints: true,
  })
  writeFileSync(join(folder, `${tag}.sql`), sql)
  writeFileSync(path, JSON.stringify(journal))
}

async function seedReleasedJournal(
  pool: TestLease['pool'],
  migrationsFolder: string,
): Promise<void> {
  // Start with the actual released journal shape, before is_contract existed.
  await pool.query(`CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`)
  for (const entry of previousJournal.entries) {
    const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8')
    await pool.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [createHash('sha256').update(sql).digest('hex'), entry.when],
    )
  }
}

it('rolls out compatibility before expands while retaining the released reader and contract fence', async () => {
  await seedReleasedJournal(lease.pool, folder)
  const previousReady = previousRevisionReadiness((sql) => lease.pool.query(sql))
  await expect(previousReady()).resolves.toBe(true)
  await expect(isMigrationJournalMatched()).resolves.toBe(true)
  const client = await lease.pool.connect()
  try {
    await migrateJournal(client, folder)
    await expect(previousReady()).resolves.toBe(true)
    await expect(isMigrationJournalMatched()).resolves.toBe(true)

    // Only the compatibility reader remains serving during the next predeploy.
    appendMigration('expand_records', 'CREATE TABLE records (value int, retired int)')
    await migrateJournal(client, folder)
    await expect(previousReady()).resolves.toBe(false)
    await expect(isMigrationJournalMatched()).resolves.toBe(true)

    appendMigration(
      'contract_records',
      `-- migrate:contract ${'a'.repeat(40)}\nALTER TABLE records DROP retired;`,
    )
    await migrateJournal(client, folder)
    await expect(isMigrationJournalMatched()).resolves.toBe(false)
    expect(
      (
        await lease.pool.query(
          'SELECT is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2',
        )
      ).rows,
    ).toEqual([{ is_contract: true }, { is_contract: false }])
  } finally {
    client.release()
  }
})

it.each([
  ['DROP SCHEMA archive CASCADE;', 'archive.historical', false],
  ['DROP MATERIALIZED VIEW record_totals;', 'public.record_totals', false],
  ['ALTER TABLE records SET SCHEMA archive;', 'public.records', false],
  ['ALTER TABLE records ALTER COLUMN value DROP DEFAULT;', 'public.records', true],
])(
  'keeps older images ready only until a declared contraction applies: %s',
  async (sql, relation, removesDefault) => {
    const caseDatabase = `test_contract_${randomUUID().replaceAll('-', '')}`
    await maintenance.pool.query(`CREATE DATABASE "${caseDatabase}"`)
    const url = new URL(getEnv().DATABASE_URL)
    url.pathname = `/${caseDatabase}`
    const caseLease = await acquireTestLease(url.toString())
    const client = await caseLease.pool.connect()
    mocks.query.mockImplementation((query: string) => caseLease.pool.query(query))
    const contractFolder = mkdtempSync(join(tmpdir(), 'readiness-contract-'))
    cpSync(join(process.cwd(), 'drizzle'), contractFolder, { recursive: true })
    try {
      await seedReleasedJournal(caseLease.pool, contractFolder)
      await client.query(`CREATE SCHEMA archive;
      CREATE TABLE archive.historical (value int);
      CREATE TABLE public.records (value int NOT NULL DEFAULT 7);
      CREATE MATERIALIZED VIEW record_totals AS SELECT count(*) FROM public.records`)
      const path = join(contractFolder, 'meta/_journal.json')
      const journal = JSON.parse(readFileSync(path, 'utf8')) as typeof previousJournal
      const tag = 'contract_relation'
      journal.entries.push({
        idx: journal.entries.length,
        tag,
        when: journal.entries.at(-1)!.when + 200_000_000,
        version: '7',
        breakpoints: true,
      })
      writeFileSync(path, JSON.stringify(journal))
      writeFileSync(join(contractFolder, `${tag}.sql`), sql)
      await expect(isMigrationJournalMatched()).resolves.toBe(true)
      expect(
        (await client.query('INSERT INTO records DEFAULT VALUES RETURNING value')).rows,
      ).toEqual([{ value: 7 }])

      await expect(migrateJournal(client, contractFolder)).rejects.toThrow(
        'reader-removal commit',
      )
      expect(
        (await client.query('SELECT to_regclass($1) AS relation', [relation])).rows[0]
          .relation,
      ).not.toBeNull()
      await expect(isMigrationJournalMatched()).resolves.toBe(true)
      expect(
        (await client.query('INSERT INTO records DEFAULT VALUES RETURNING value')).rows,
      ).toEqual([{ value: 7 }])

      writeFileSync(
        join(contractFolder, `${tag}.sql`),
        `-- migrate:contract ${'a'.repeat(40)}\n${sql}`,
      )
      await migrateJournal(client, contractFolder)
      expect(
        (
          await client.query(
            'SELECT is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
          )
        ).rows,
      ).toEqual([{ is_contract: true }])
      await expect(isMigrationJournalMatched()).resolves.toBe(false)
      if (removesDefault) {
        await expect(
          client.query('INSERT INTO records DEFAULT VALUES'),
        ).rejects.toMatchObject({
          code: '23502',
        })
        await client.query('INSERT INTO records (value) VALUES (9)')
      }
    } finally {
      client.release()
      await caseLease.release()
      mocks.query.mockImplementation((query: string) => lease.pool.query(query))
      await maintenance.pool.query(`DROP DATABASE "${caseDatabase}"`)
      rmSync(contractFolder, { recursive: true })
    }
  },
)
