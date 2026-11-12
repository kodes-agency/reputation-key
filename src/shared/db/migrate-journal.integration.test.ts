import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PoolClient } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { migrateJournal } from './migrate-journal.server'

const folders: string[] = []
function journal(
  files: readonly string[],
  identities: readonly { when: number; prerequisite?: boolean }[] = [],
): string {
  const folder = mkdtempSync(join(tmpdir(), 'journal-recovery-'))
  folders.push(folder)
  mkdirSync(join(folder, 'meta'))
  const entries = files.map((sql, idx) => {
    const tag = `migration_${idx}`
    writeFileSync(join(folder, `${tag}.sql`), sql)
    return {
      idx,
      tag,
      when: identities[idx]?.when ?? 1000 + idx,
      breakpoints: true,
      version: '7',
      prerequisite: identities[idx]?.prerequisite,
    }
  })
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  )
  return folder
}

describe('journal recovery through PostgreSQL', () => {
  let maintenance: TestLease
  let database: string
  let lease: TestLease
  let migrator: PoolClient
  let observer: PoolClient

  beforeAll(async () => {
    maintenance = await acquireTestLease(getEnv().DATABASE_URL)
  })
  beforeEach(async () => {
    database = `test_journal_${randomUUID().replaceAll('-', '')}`
    await maintenance.pool.query(`CREATE DATABASE "${database}"`)
    const url = new URL(getEnv().DATABASE_URL)
    url.pathname = `/${database}`
    lease = await acquireTestLease(url.toString())
    migrator = await lease.pool.connect()
    observer = await lease.pool.connect()
  })
  afterEach(async () => {
    if (migrator) {
      await migrator.query('ROLLBACK')
      migrator.release()
    }
    if (observer) {
      await observer.query('ROLLBACK')
      observer.release()
    }
    await lease?.release()
    if (database) await maintenance.pool.query(`DROP DATABASE "${database}"`)
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true })
  })
  afterAll(async () => {
    await maintenance?.release()
  })

  async function applied() {
    return (
      await observer.query(
        'SELECT hash, created_at::int AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
      )
    ).rows
  }
  async function expectJournal(files: readonly string[]) {
    expect(await applied()).toEqual(
      files.map((sql, idx) => ({
        hash: createHash('sha256').update(sql).digest('hex'),
        created_at: 1000 + idx,
      })),
    )
  }
  async function expectLocksReleased() {
    const lock = await observer.query(
      "SELECT pg_try_advisory_lock(hashtextextended('repkey-migration-journal', 0)) AS acquired",
    )
    try {
      expect(lock.rows[0].acquired).toBe(true)
    } finally {
      await observer.query(
        "SELECT pg_advisory_unlock(hashtextextended('repkey-migration-journal', 0))",
      )
    }
    await observer.query('BEGIN')
    try {
      await observer.query("SET LOCAL lock_timeout = '100ms'")
      await observer.query('LOCK TABLE first_file IN ACCESS EXCLUSIVE MODE')
    } finally {
      await observer.query('ROLLBACK')
    }
  }
  async function rejectSecondJournalRow() {
    await migrateJournal(migrator, journal([]))
    await observer.query(`CREATE FUNCTION reject_journal_row() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.created_at = 1001 THEN RAISE EXCEPTION 'journal write refused'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_journal_row BEFORE INSERT ON drizzle.__drizzle_migrations FOR EACH ROW EXECUTE FUNCTION reject_journal_row();`)
  }

  it.each([
    'ALTER TABLE records DROP retired;',
    'ALTER TABLE records ALTER value TYPE bigint;',
  ])('requires reader removal and journals the contraction: %s', async (sql) => {
    await observer.query(
      'CREATE TABLE records (value int, retired int); INSERT INTO records VALUES (1, 2)',
    )
    await expect(migrateJournal(migrator, journal([sql]))).rejects.toThrow(
      'reader-removal commit',
    )
    expect((await observer.query('SELECT * FROM records')).rows).toEqual([
      { value: 1, retired: 2 },
    ])
    expect(
      (
        await observer.query(
          "SELECT to_regclass('drizzle.__drizzle_migrations') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull()

    const file = `-- migrate:contract ${'a'.repeat(40)}\n${sql}`
    const folder = journal([file])
    await migrateJournal(migrator, folder)
    await migrateJournal(migrator, folder)
    expect(
      (await observer.query('SELECT is_contract FROM drizzle.__drizzle_migrations')).rows,
    ).toEqual([{ is_contract: true }])
    await expectJournal([file])
  })

  it('resumes missing historical files after the auth prerequisite has committed', async () => {
    const files = [
      `-- migrate:contract ${'a'.repeat(40)}\nCREATE TABLE first_file (id int REFERENCES auth_table(id)); SELECT * FROM dependency`,
      'CREATE TABLE auth_table (id int PRIMARY KEY)',
    ]
    const folder = journal(files)
    writeFileSync(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: files.map((_sql, idx) => ({
          idx,
          tag: `migration_${idx}`,
          when: 1000 + idx,
          version: '7',
          breakpoints: true,
          prerequisite: idx === 1,
        })),
      }),
    )

    await expect(migrateJournal(migrator, folder)).rejects.toMatchObject({
      code: '42P01',
    })
    expect(
      (await observer.query("SELECT to_regclass('first_file') AS relation")).rows[0]
        .relation,
    ).toBeNull()
    expect((await applied()).map((row) => row.created_at)).toEqual([1001])
    await observer.query('CREATE TABLE dependency (id int)')
    await migrateJournal(migrator, folder)
    await migrateJournal(migrator, folder)
    await expectJournal(files)
    expect(
      (await observer.query("SELECT to_regclass('first_file') AS relation")).rows[0]
        .relation,
    ).toBe('first_file')
  })

  it('runs a prerequisite in journal order once history is applied, so a refused file commits nothing', async () => {
    const files = [
      'CREATE TABLE first_file (id int)',
      `-- migrate:contract ${'a'.repeat(40)}\nCREATE TABLE refused_file (id int); SELECT * FROM dependency`,
      'CREATE TABLE auth_table (id int PRIMARY KEY)',
    ]
    const identities = [
      { when: 1000 },
      { when: 1001 },
      { when: 1002, prerequisite: true },
    ]
    await migrateJournal(migrator, journal(files.slice(0, 1), identities.slice(0, 1)))
    const before = await applied()

    await expect(
      migrateJournal(migrator, journal(files, identities)),
    ).rejects.toMatchObject({
      code: '42P01',
    })

    expect(await applied()).toEqual(before)
    expect(
      (await observer.query("SELECT to_regclass('auth_table') AS relation")).rows[0]
        .relation,
    ).toBeNull()
    await observer.query('CREATE TABLE dependency (id int)')
    await migrateJournal(migrator, journal(files, identities))
    await expectJournal(files)
    await expectLocksReleased()
  })

  it('refuses an older journal even when every local file is already applied', async () => {
    const files = [
      'CREATE TABLE first_file (id int)',
      'CREATE TABLE next_file (id int)',
      'CREATE TABLE future_file (id int)',
    ]
    await migrateJournal(migrator, journal(files))
    const before = await applied()

    await expect(migrateJournal(migrator, journal(files.slice(0, 2)))).rejects.toThrow(
      /(?:applied|database|migration|journal)/i,
    )

    expect(await applied()).toEqual(before)
    await expectLocksReleased()
    await migrateJournal(migrator, journal(files))
    await expectJournal(files)
  })

  it('refuses an older journal after a future prerequisite commits and historical files roll back', async () => {
    const files = [
      `-- migrate:contract ${'a'.repeat(40)}\nCREATE TABLE first_file (id int REFERENCES auth_table(id)); SELECT * FROM dependency`,
      'CREATE TABLE next_file (id int)',
      'CREATE TABLE auth_table (id int PRIMARY KEY)',
    ]
    const folder = journal(files, [
      { when: 1000 },
      { when: 1001 },
      { when: 1002, prerequisite: true },
    ])
    await expect(migrateJournal(migrator, folder)).rejects.toMatchObject({
      code: '42P01',
    })
    const before = await applied()
    expect(before).toEqual([
      { hash: createHash('sha256').update(files[2]!).digest('hex'), created_at: 1002 },
    ])
    await observer.query('CREATE TABLE dependency (id int)')

    await expect(migrateJournal(migrator, journal(files.slice(0, 2)))).rejects.toThrow(
      /(?:applied|database|migration|journal)/i,
    )

    expect(await applied()).toEqual(before)
    expect(
      (await observer.query("SELECT to_regclass('first_file') AS relation")).rows[0]
        .relation,
    ).toBeNull()
    expect(
      (await observer.query("SELECT to_regclass('next_file') AS relation")).rows[0]
        .relation,
    ).toBeNull()
    await migrateJournal(migrator, folder)
    await migrateJournal(migrator, folder)
    await expectJournal(files)
    await expectLocksReleased()
  })

  it('refuses an unknown non-latest timestamp before applying a missing local file', async () => {
    const first = 'CREATE TABLE first_file (id int)'
    const unknown = 'CREATE TABLE unknown_file (id int)'
    const latest = 'CREATE TABLE latest_file (id int)'
    await migrateJournal(
      migrator,
      journal([first, unknown, latest], [{ when: 1000 }, { when: 1003 }, { when: 1004 }]),
    )
    const before = await applied()
    const folder = journal(
      [first, 'CREATE TABLE missing_file (id int)', latest],
      [{ when: 1000 }, { when: 1002 }, { when: 1004 }],
    )

    await expect(migrateJournal(migrator, folder)).rejects.toThrow(
      /(?:applied|database|migration|journal)/i,
    )

    expect(await applied()).toEqual(before)
    expect(
      (await observer.query("SELECT to_regclass('missing_file') AS relation")).rows[0]
        .relation,
    ).toBeNull()
    await expectLocksReleased()
  })

  it('durably commits earlier files, rolls back every failed-file statement and releases locks before a rerun', async () => {
    await observer.query('CREATE TABLE blocked (id int)')
    await observer.query('BEGIN; LOCK TABLE blocked IN ACCESS EXCLUSIVE MODE')
    const files = [
      `-- migrate:contract ${'a'.repeat(40)}\nCREATE TABLE first_file (id int); INSERT INTO first_file VALUES (1)`,
      'CREATE TABLE partial_file (id int);--> statement-breakpointALTER TABLE blocked ADD COLUMN value int',
    ]
    const folder = journal(files)
    try {
      await expect(migrateJournal(migrator, folder)).rejects.toMatchObject({
        code: '55P03',
      })
      expect(
        (await migrator.query("SELECT to_regclass('partial_file') AS relation")).rows[0]
          .relation,
      ).toBeNull()
      expect((await migrator.query('SELECT * FROM first_file')).rows).toEqual([{ id: 1 }])
      // Use a third connection because the blocker is still in its transaction.
      expect(
        (
          await lease.pool.query(
            'SELECT created_at::int FROM drizzle.__drizzle_migrations',
          )
        ).rows,
      ).toEqual([{ created_at: 1000 }])
    } finally {
      await observer.query('ROLLBACK')
    }
    await expectLocksReleased()
    await migrateJournal(migrator, folder)
    await migrateJournal(migrator, folder)
    await expectJournal(files)
    expect((await observer.query('SELECT * FROM first_file')).rows).toEqual([{ id: 1 }])
    expect(
      (
        await observer.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'blocked' AND column_name = 'value'",
        )
      ).rowCount,
    ).toBe(1)
  })

  it('atomically rolls back DDL when the journal INSERT itself fails', async () => {
    await rejectSecondJournalRow()
    const files = ['CREATE TABLE first_file (id int)', 'CREATE TABLE unrecorded (id int)']
    const folder = journal(files)
    await expect(migrateJournal(migrator, folder)).rejects.toMatchObject({
      code: 'P0001',
    })
    expect(
      (await observer.query("SELECT to_regclass('unrecorded') AS relation")).rows[0]
        .relation,
    ).toBeNull()
    await expectJournal(files.slice(0, 1))
    await expectLocksReleased()
    await observer.query(
      'DROP TRIGGER reject_journal_row ON drizzle.__drizzle_migrations',
    )
    await migrateJournal(migrator, folder)
    await migrateJournal(migrator, folder)
    await expectJournal(files)
  })

  it('rejects unsafe checks before changing a populated database and validates safe checks separately', async () => {
    await observer.query(
      'CREATE TABLE records (value int); INSERT INTO records VALUES (1)',
    )
    await expect(
      migrateJournal(
        migrator,
        journal(['ALTER TABLE records ADD CONSTRAINT positive CHECK (value > 0)']),
      ),
    ).rejects.toThrow('NOT VALID')
    expect(
      (
        await observer.query(
          "SELECT to_regclass('drizzle.__drizzle_migrations') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull()
    const add = 'ALTER TABLE records ADD CONSTRAINT positive CHECK (value > 0) NOT VALID'
    await migrateJournal(migrator, journal([add]))
    expect(
      (
        await observer.query(
          "SELECT convalidated FROM pg_constraint WHERE conname = 'positive'",
        )
      ).rows,
    ).toEqual([{ convalidated: false }])
    await expect(observer.query('INSERT INTO records VALUES (-1)')).rejects.toMatchObject(
      { code: '23514' },
    )
    await migrateJournal(
      migrator,
      journal([add, 'ALTER TABLE records VALIDATE CONSTRAINT positive']),
    )
    expect(
      (
        await observer.query(
          "SELECT convalidated FROM pg_constraint WHERE conname = 'positive'",
        )
      ).rows,
    ).toEqual([{ convalidated: true }])
  })

  it('repairs a genuinely interrupted concurrent build and converges without repeating earlier files', async () => {
    await observer.query(
      'CREATE TABLE records (value int); INSERT INTO records VALUES (1)',
    )
    await observer.query('BEGIN; UPDATE records SET value = 2')
    const files = [
      'CREATE TABLE first_file (id int)',
      '-- migrate:nontransactional\nCREATE INDEX CONCURRENTLY "records_value_idx" ON "records" ("value");',
    ]
    const folder = journal(files)
    const pid = (await migrator.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid as number
    const attempt = migrateJournal(migrator, folder).then(
      () => null,
      (error: unknown) => error,
    )
    try {
      const deadline = Date.now() + 4000
      let invalid = false
      while (Date.now() < deadline) {
        const index = await lease.pool.query(
          "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('records_value_idx')",
        )
        if (index.rows[0]?.indisvalid === false) {
          invalid = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(invalid).toBe(true)
      await lease.pool.query('SELECT pg_cancel_backend($1)', [pid])
      expect(await attempt).toBeInstanceOf(Error)
    } finally {
      await lease.pool.query('SELECT pg_cancel_backend($1)', [pid])
      await attempt
      await observer.query('ROLLBACK')
    }
    expect(
      (
        await observer.query(
          "SELECT indisvalid FROM pg_index WHERE indexrelid = 'records_value_idx'::regclass",
        )
      ).rows,
    ).toEqual([{ indisvalid: false }])
    await expectJournal(files.slice(0, 1))
    await expectLocksReleased()
    const indexLock = await observer.query(
      "SELECT pg_try_advisory_lock(hashtextextended('repkey-concurrent-index-sidecar-v1:records_value_idx', 0)) AS acquired",
    )
    expect(indexLock.rows[0].acquired).toBe(true)
    await observer.query(
      "SELECT pg_advisory_unlock(hashtextextended('repkey-concurrent-index-sidecar-v1:records_value_idx', 0))",
    )
    await migrateJournal(migrator, folder)
    await migrateJournal(migrator, folder)
    await expectJournal(files)
    expect(
      (
        await observer.query(
          "SELECT indisvalid, indisready FROM pg_index WHERE indexrelid = 'records_value_idx'::regclass",
        )
      ).rows,
    ).toEqual([{ indisvalid: true, indisready: true }])
  })

  it('reuses a completed index when recording its journal row was interrupted', async () => {
    await rejectSecondJournalRow()
    await observer.query('CREATE TABLE records (value int)')
    const files = [
      'CREATE TABLE first_file (id int)',
      '-- migrate:nontransactional\nCREATE INDEX CONCURRENTLY "records_value_idx" ON "records" ("value");',
    ]
    const folder = journal(files)
    await expect(migrateJournal(migrator, folder)).rejects.toMatchObject({
      code: 'P0001',
    })
    const before = (
      await observer.query("SELECT 'records_value_idx'::regclass::oid AS oid")
    ).rows[0].oid
    await expectJournal(files.slice(0, 1))
    await observer.query(
      'DROP TRIGGER reject_journal_row ON drizzle.__drizzle_migrations',
    )
    await migrateJournal(migrator, folder)
    await expectJournal(files)
    expect(
      (await observer.query("SELECT 'records_value_idx'::regclass::oid AS oid")).rows[0]
        .oid,
    ).toBe(before)
  })

  it.each([false, true])(
    'recovers an unrecorded partial index using the corrected predicate (unique=%s)',
    async (unique) => {
      await rejectSecondJournalRow()
      await observer.query(
        "CREATE TABLE records (value int, state text); INSERT INTO records VALUES (1, 'READY'), (2, 'ready')",
      )
      const indexSql = (predicate: string) =>
        `${unique ? `-- migrate:contract ${'a'.repeat(40)}\n` : ''}-- migrate:nontransactional\nCREATE ${unique ? 'UNIQUE ' : ''}INDEX CONCURRENTLY "records_value_idx" ON "records" ("value") WHERE ${predicate};`
      const files = ['CREATE TABLE first_file (id int)', indexSql("state = 'READY'")]
      const folder = journal(files)
      await expect(migrateJournal(migrator, folder)).rejects.toMatchObject({
        safeCode: 'index_journal_write_failed',
        code: 'P0001',
      })
      const before = (
        await observer.query("SELECT 'records_value_idx'::regclass::oid AS oid")
      ).rows[0].oid
      await expectJournal(files.slice(0, 1))
      files[1] = indexSql("state = 'ready'")
      writeFileSync(join(folder, 'migration_1.sql'), files[1])
      await observer.query(
        'DROP TRIGGER reject_journal_row ON drizzle.__drizzle_migrations',
      )

      await migrateJournal(migrator, folder)
      await expectJournal(files)
      const index = (
        await observer.query(`SELECT indexrelid AS oid, indisunique, indisvalid, indisready,
      pg_get_expr(indpred, indrelid) AS predicate FROM pg_index
      WHERE indexrelid = 'records_value_idx'::regclass`)
      ).rows[0]
      expect(index).toMatchObject({
        indisunique: unique,
        indisvalid: true,
        indisready: true,
        predicate: "(state = 'ready'::text)",
      })
      expect(index.oid).not.toBe(before)
      if (unique) {
        await expect(
          observer.query("INSERT INTO records VALUES (2, 'ready')"),
        ).rejects.toMatchObject({ code: '23505' })
        await observer.query("INSERT INTO records VALUES (1, 'READY')")
      }

      // PostgreSQL's casts and parentheses must not force an identical predicate to rebuild.
      await observer.query(
        'DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1001',
      )
      files[1] = indexSql('(("state" = \'ready\'::text))')
      writeFileSync(join(folder, 'migration_1.sql'), files[1])
      await migrateJournal(migrator, folder)
      await migrateJournal(migrator, folder)
      await expectJournal(files)
      expect(
        (await observer.query("SELECT 'records_value_idx'::regclass::oid AS oid")).rows[0]
          .oid,
      ).toBe(index.oid)
    },
  )
})
