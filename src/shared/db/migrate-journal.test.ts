import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateJournal } from './migrate-journal.server'
import { MIGRATION_LOCK_SQL, MIGRATION_UNLOCK_SQL } from './migration-session-lock'
import { isMigrationLockTimeout } from './migration-lock-timeout'
import { readMigrationJournal } from './migration-journal-order'
import { deployFailureRecovery } from './migration-journal-state'

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true })
})

function journal(
  files: readonly string[],
  identities: readonly { tag: string; when: number }[] = [],
): string {
  const folder = mkdtempSync(join(tmpdir(), 'migration-journal-'))
  folders.push(folder)
  mkdirSync(join(folder, 'meta'))
  const entries = files.map((sql, idx) => {
    const { tag, when } = identities[idx] ?? {
      tag: `migration_${idx}`,
      when: 1000 + idx,
    }
    writeFileSync(join(folder, `${tag}.sql`), sql)
    return { idx, tag, when, breakpoints: true, version: '7' }
  })
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  )
  return folder
}

type Applied = { hash: string; created_at: number }

// Models transaction rollback and durable journal rows; no database connection.
function database(applied: Applied[] = []) {
  const statements: string[] = []
  const journalWrites: unknown[][] = []
  const effects: string[] = []
  const state = {
    applied: [...applied],
    failOnceOn: '',
    rollbackFails: false,
  }
  const failure = Object.assign(new Error('lock wait'), { code: '55P03' })
  let transaction: { applied: Applied[]; effects: string[] } | undefined
  return {
    state,
    statements,
    journalWrites,
    effects,
    failure,
    session: {
      async query(text: string, values?: unknown[]) {
        statements.push(text)
        if (state.failOnceOn && text.includes(state.failOnceOn)) {
          state.failOnceOn = ''
          throw failure
        }
        if (text.startsWith('SELECT id, hash, created_at')) {
          return { rows: state.applied.map((row, index) => ({ id: index + 1, ...row })) }
        }
        if (text === 'BEGIN') {
          if (transaction) throw new Error('nested transaction')
          transaction = { applied: [...state.applied], effects: [...effects] }
        } else if (text === 'ROLLBACK') {
          if (state.rollbackFails) throw new Error('connection lost')
          if (!transaction) throw new Error('no transaction')
          state.applied = transaction.applied
          effects.splice(0, effects.length, ...transaction.effects)
          transaction = undefined
        } else if (text === 'COMMIT') {
          if (!transaction) throw new Error('no transaction')
          transaction = undefined
        } else if (text.startsWith('INSERT INTO "drizzle"')) {
          journalWrites.push(values ?? [])
          state.applied.push({
            hash: String(values?.[0]),
            created_at: Number(values?.[1]),
          })
        } else if (
          !text.startsWith('SELECT pg_advisory_') &&
          !text.startsWith('SET ') &&
          !text.startsWith('RESET ') &&
          !text.startsWith('CREATE SCHEMA IF NOT EXISTS "drizzle"') &&
          !text.startsWith('CREATE TABLE IF NOT EXISTS "drizzle"') &&
          !text.startsWith('ALTER TABLE "drizzle"."__drizzle_migrations"')
        ) {
          effects.push(text)
        }
        return { rows: [] }
      },
    },
  }
}

describe('migrateJournal', () => {
  it.each([
    ['0083_review_analysis_v3_switch_on', 'NOT VALID'],
    ['0053_clear_legacy_asset_urls', 'reader-removal commit'],
  ])(
    'checks copied legacy SQL before executing or recording it: %s',
    async (tag, error) => {
      const original = readMigrationJournal().find((entry) => entry.tag === tag)!
      const sql = readFileSync(
        new URL(`../../../drizzle/${tag}.sql`, import.meta.url),
        'utf8',
      )
      for (const identity of [
        { tag: 'copied_legacy', when: original.when },
        { tag, when: original.when + 1 },
        { tag: 'copied_legacy', when: original.when + 1 },
      ]) {
        const db = database()

        await expect(
          migrateJournal(db.session, journal([sql], [identity])),
        ).rejects.toThrow(error)
        expect(db.statements).toEqual([])
        expect(db.journalWrites).toEqual([])
        expect(db.state.applied).toEqual([])
      }
    },
  )

  it('executes legacy SQL under its original journal identity', async () => {
    const original = readMigrationJournal().find(
      ({ tag }) => tag === '0083_review_analysis_v3_switch_on',
    )!
    const sql = readFileSync(
      new URL(`../../../drizzle/${original.tag}.sql`, import.meta.url),
      'utf8',
    )
    const db = database()

    await migrateJournal(db.session, journal([sql], [original]))

    expect(db.journalWrites).toEqual([
      [createHash('sha256').update(sql).digest('hex'), original.when, false],
    ])
    expect(db.effects.length).toBeGreaterThan(0)
  })

  it.each([
    'DROP SCHEMA archive CASCADE;',
    'DROP MATERIALIZED VIEW record_totals;',
    'ALTER TABLE records SET SCHEMA archive;',
    'ALTER TABLE records DROP retired;',
    'ALTER TABLE records ALTER value TYPE bigint;',
    'ALTER TABLE records ALTER COLUMN value DROP DEFAULT;',
    'UNKNOWN MIGRATION STATEMENT;',
  ])(
    'refuses an undeclared contraction before journal or schema changes: %s',
    async (sql) => {
      const db = database()

      await expect(migrateJournal(db.session, journal([sql]))).rejects.toThrow(
        'reader-removal commit',
      )
      expect(db.statements).toEqual([])
      expect(db.state.applied).toEqual([])
    },
  )

  it.each([
    'DROP SCHEMA archive CASCADE;',
    'DROP MATERIALIZED VIEW record_totals;',
    'ALTER TABLE records SET SCHEMA archive;',
    'ALTER TABLE records DROP retired;',
    'ALTER TABLE records ALTER value TYPE bigint;',
    'ALTER TABLE records ALTER COLUMN value DROP DEFAULT;',
    'UNKNOWN MIGRATION STATEMENT;',
  ])('records a declared contraction rather than an expand: %s', async (sql) => {
    const file = `-- migrate:contract ${'a'.repeat(40)}\n${sql}`
    const db = database()

    await migrateJournal(db.session, journal([file]))

    expect(db.journalWrites).toEqual([
      [createHash('sha256').update(file).digest('hex'), 1000, true],
    ])
  })

  it('refuses an existing-table CHECK that would scan rows under the DDL lock', async () => {
    const folder = journal([
      'ALTER TABLE populated ADD CONSTRAINT positive CHECK (value > 0)',
    ])
    const db = database()

    await expect(migrateJournal(db.session, folder)).rejects.toThrow('NOT VALID')
    expect(db.state.applied).toEqual([])
    expect(db.effects).toEqual([])
  })

  it('refuses CHECK validation in the file that adds it', async () => {
    const folder = journal([
      'ALTER TABLE populated ADD CONSTRAINT positive CHECK (value > 0) NOT VALID;--> statement-breakpointALTER TABLE populated VALIDATE CONSTRAINT positive;',
    ])
    const db = database()

    await expect(migrateJournal(db.session, folder)).rejects.toThrow('separate file')
    expect(db.state.applied).toEqual([])
    expect(db.effects).toEqual([])
  })

  it('keeps completed files after a later lock wait and resumes without repeating them', async () => {
    const folder = journal([
      'CREATE TABLE first_file (id int)',
      'CREATE TABLE next_file (id int)',
    ])
    const db = database()
    db.state.failOnceOn = 'CREATE TABLE next_file'

    await expect(migrateJournal(db.session, folder)).rejects.toBe(db.failure)
    expect(db.state.applied).toHaveLength(1)
    expect(db.effects).toEqual(['CREATE TABLE first_file (id int)'])
    expect(db.statements.at(-2)).toBe('ROLLBACK')
    expect(db.statements.at(-1)).toBe(MIGRATION_UNLOCK_SQL)
    expect(db.statements).not.toContain('RESET lock_timeout')

    await migrateJournal(db.session, folder)
    expect(db.state.applied).toHaveLength(2)
    expect(db.effects).toEqual([
      'CREATE TABLE first_file (id int)',
      'CREATE TABLE next_file (id int)',
    ])
    expect(
      db.statements.filter((sql) => sql === 'CREATE TABLE first_file (id int)'),
    ).toHaveLength(1)

    const before = [...db.effects]
    await migrateJournal(db.session, folder)
    expect(db.effects).toEqual(before)
    expect(db.state.applied).toHaveLength(2)
  })

  it('rolls back every statement and the journal row of a failing file only', async () => {
    const folder = journal([
      'CREATE TABLE earlier_file (id int)',
      'CREATE TABLE partial_file (id int)--> statement-breakpointALTER TABLE blocked ADD COLUMN value int',
    ])
    const db = database()
    db.state.failOnceOn = 'ALTER TABLE blocked'

    await expect(migrateJournal(db.session, folder)).rejects.toBe(db.failure)

    expect(db.effects).toEqual(['CREATE TABLE earlier_file (id int)'])
    expect(db.state.applied.map((row) => row.created_at)).toEqual([1000])
  })

  it('does not commit schema changes when recording the file fails', async () => {
    const folder = journal(['CREATE TABLE unrecorded (id int)'])
    const db = database()
    db.state.failOnceOn = 'INSERT INTO "drizzle"'

    await expect(migrateJournal(db.session, folder)).rejects.toBe(db.failure)

    expect(db.effects).toEqual([])
    expect(db.state.applied).toEqual([])
    await migrateJournal(db.session, folder)
    expect(db.effects).toEqual(['CREATE TABLE unrecorded (id int)'])
    expect(db.state.applied).toHaveLength(1)
  })

  it('records the same hashes and timestamps as Drizzle and commits between files', async () => {
    const files = [
      'CREATE TABLE first_file (id int)--> statement-breakpointALTER TABLE first_file ADD COLUMN value int',
      'CREATE TABLE next_file (id int)',
    ]
    const folder = journal(files)
    const db = database()

    await migrateJournal(db.session, folder)

    expect(db.state.applied).toEqual(
      files.map((sql, idx) => ({
        hash: createHash('sha256').update(sql).digest('hex'),
        created_at: 1000 + idx,
      })),
    )
    expect(db.statements.filter((sql) => ['BEGIN', 'COMMIT'].includes(sql))).toEqual([
      'BEGIN',
      'COMMIT',
      'BEGIN',
      'COMMIT',
    ])
    expect(db.statements[0]).toBe(MIGRATION_LOCK_SQL)
    expect(db.statements[1]).toBe('SET lock_timeout = 5000')
    expect(db.statements.at(-2)).toBe('RESET lock_timeout')
    expect(db.statements.at(-1)).toBe(MIGRATION_UNLOCK_SQL)
  })

  it('accepts an already migrated Drizzle journal without opening a transaction', async () => {
    const folder = journal(['CREATE TABLE existing_file (id int)'])
    const existing = {
      hash: createHash('sha256')
        .update('CREATE TABLE existing_file (id int)')
        .digest('hex'),
      created_at: 1000,
    }
    const db = database([existing])

    await migrateJournal(db.session, folder)

    expect(db.state.applied).toEqual([existing])
    expect(db.effects).toEqual([])
    expect(db.statements).not.toContain('BEGIN')
  })

  it('accepts the hash the beta recorded before a file was edited, for that migration only', async () => {
    const recorded = 'b42c4fb6cf040663e03fe492c5931898fa321d6724efcc081e72d26c3392886d'
    const edited = journal(
      ['CREATE TABLE edited_after_apply (id int)'],
      [{ tag: '0001_db_constructs', when: 1788840803209 }],
    )
    const db = database([{ hash: recorded, created_at: 1788840803209 }])

    await migrateJournal(db.session, edited)

    expect(db.statements).not.toContain('BEGIN')
    expect(db.effects).toEqual([])

    const elsewhere = journal(
      ['CREATE TABLE other_file (id int)'],
      [{ tag: 'other', when: 1788840803210 }],
    )
    const other = database([{ hash: recorded, created_at: 1788840803210 }])
    await expect(migrateJournal(other.session, elsewhere)).rejects.toThrow(
      'Applied migration changed',
    )
  })

  it('refuses an applied file whose contents changed', async () => {
    const folder = journal(['CREATE TABLE changed_file (id int)'])
    const db = database([{ hash: 'different-applied-hash', created_at: 1000 }])

    await expect(migrateJournal(db.session, folder)).rejects.toThrow(
      'Applied migration changed',
    )
    expect(db.statements).not.toContain('BEGIN')
    expect(db.effects).toEqual([])
  })

  it.each([
    ['all local files applied', [0, 1]],
    ['some local files missing', [0]],
    ['only a future prerequisite applied', []],
  ])('refuses an unknown future migration with %s', async (_state, appliedIndexes) => {
    const files = ['CREATE TABLE first_file (id int)', 'CREATE TABLE next_file (id int)']
    const applied = [
      ...appliedIndexes.map((idx) => ({
        hash: createHash('sha256').update(files[idx]!).digest('hex'),
        created_at: 1000 + idx,
      })),
      {
        hash: createHash('sha256').update('future prerequisite').digest('hex'),
        created_at: 1002,
      },
    ]
    const db = database(applied)

    const migration = migrateJournal(db.session, journal(files))
    await expect(migration).rejects.toThrow(/(?:applied|database|migration|journal)/i)
    await expect(migration).rejects.toMatchObject({ name: 'ImageOlderThanDatabaseError' })
    const recovery = await migration.catch((error: unknown) =>
      deployFailureRecovery(error, 'journal'),
    )
    expect(recovery).toContain('Forward-only recovery:')
    expect(recovery).not.toContain('the rerun converges')

    expect(db.state.applied).toEqual(applied)
    expect(db.journalWrites).toEqual([])
    expect(db.effects).toEqual([])
    expect(db.statements).not.toContain('BEGIN')
    expect(db.statements.at(-1)).toBe(MIGRATION_UNLOCK_SQL)
  })

  it('refuses an unknown timestamp below a known latest migration before filling historical gaps', async () => {
    const files = [
      'CREATE TABLE first_file (id int)',
      'CREATE TABLE missing_file (id int)',
      'CREATE TABLE last_file (id int)',
    ]
    const identities = files.map((_sql, idx) => ({
      tag: `migration_${idx}`,
      when: 1000 + idx * 2,
    }))
    const applied = [
      { hash: createHash('sha256').update(files[0]!).digest('hex'), created_at: 1000 },
      {
        hash: createHash('sha256').update('unknown migration').digest('hex'),
        created_at: 1003,
      },
      { hash: createHash('sha256').update(files[2]!).digest('hex'), created_at: 1004 },
    ]
    const db = database(applied)

    const migration = migrateJournal(db.session, journal(files, identities))
    await expect(migration).rejects.toThrow(/(?:applied|database|migration|journal)/i)
    await expect(migration).rejects.toMatchObject({ name: 'ImageOlderThanDatabaseError' })
    const recovery = await migration.catch((error: unknown) =>
      deployFailureRecovery(error, 'journal'),
    )
    expect(recovery).toContain('Forward-only recovery:')
    expect(recovery).not.toContain('the rerun converges')

    expect(db.state.applied).toEqual(applied)
    expect(db.journalWrites).toEqual([])
    expect(db.effects).toEqual([])
    expect(db.statements).not.toContain('BEGIN')
    expect(db.statements.at(-1)).toBe(MIGRATION_UNLOCK_SQL)
  })

  it('preserves the original timeout if rollback also loses the connection', async () => {
    const folder = journal(['ALTER TABLE blocked ADD COLUMN value int'])
    const db = database()
    db.state.failOnceOn = 'ALTER TABLE blocked'
    db.state.rollbackFails = true

    const error = await migrateJournal(db.session, folder).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBe(db.failure)
    expect(isMigrationLockTimeout(error)).toBe(true)
    expect(db.statements.at(-2)).toBe('ROLLBACK')
    expect(db.statements.at(-1)).toBe(MIGRATION_UNLOCK_SQL)
  })

  it('reads all files before changing the database', async () => {
    const folder = journal([
      'CREATE TABLE first_file (id int)',
      'CREATE TABLE missing_file (id int)',
    ])
    rmSync(join(folder, 'migration_1.sql'))
    const db = database()

    await expect(migrateJournal(db.session, folder)).rejects.toThrow('No file')

    expect(db.statements).toEqual([])
  })
})
