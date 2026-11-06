import { readMigrationFiles } from 'drizzle-orm/migrator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildConcurrentIndex,
  ConcurrentIndexMigrationError,
} from './concurrent-index-migration'
import { journalConcurrentIndex } from './journal-concurrent-index'
import { assertOnlineConstraints, contractionRequirement } from './migration-safety'
import { withMigrationLockTimeout } from './migration-lock-timeout'
import { withMigrationSessionLock } from './migration-session-lock'
import { ImageOlderThanDatabaseError } from './migration-journal-state'
import type { QueryResult } from 'pg'

type JournalSession = Readonly<{
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>
}>

type JournalMigration = ReturnType<typeof readMigrationFiles>[number] & {
  contract: boolean
}

async function recordMigration(
  session: JournalSession,
  migration: JournalMigration,
): Promise<void> {
  await session.query(
    'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at", "is_contract") VALUES ($1, $2, $3)',
    [migration.hash, migration.folderMillis, migration.contract],
  )
}

async function recordConcurrentIndex(
  session: JournalSession,
  migration: JournalMigration,
): Promise<void> {
  // The build is durable before its journal row. Recovery inspects and
  // reuses that index if the process stops between these two statements.
  try {
    await recordMigration(session, migration)
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined
    throw new ConcurrentIndexMigrationError('index_journal_write_failed', code)
  }
}

async function applyTransactionalMigration(
  session: JournalSession,
  migration: JournalMigration,
): Promise<void> {
  await session.query('BEGIN')
  try {
    for (const statement of migration.sql) await session.query(statement)
    await recordMigration(session, migration)
    await session.query('COMMIT')
  } catch (error) {
    // Preserve the SQLSTATE even if the connection also fails during rollback.
    await session.query('ROLLBACK').catch(() => {})
    throw error
  }
}

/**
 * Commits each file with its journal row, releasing its locks before the next
 * file. Drizzle supplies file hashes, breakpoints and timestamps.
 * The deploy caller holds its session advisory lock across the entire run.
 */
export async function migrateJournal(
  session: JournalSession,
  migrationsFolder: string,
): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder })
  const journal = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed migration history, never request input
    readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as {
    entries: { tag: string; when: number; prerequisite?: boolean }[]
  }
  const files = migrations.map((migration, index) => {
    const sql = migration.sql.join('--> statement-breakpoint')
    const entry = journal.entries[index]
    assertOnlineConstraints(sql, entry)
    const contract = contractionRequirement(sql, entry) !== null
    return {
      ...migration,
      contract,
      prerequisite: entry?.prerequisite === true,
      concurrentIndex: journalConcurrentIndex(sql),
    }
  })
  await withMigrationSessionLock(session, () =>
    withMigrationLockTimeout(session, async () => {
      await session.query('CREATE SCHEMA IF NOT EXISTS "drizzle"')
      await session.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint,
      is_contract boolean NOT NULL DEFAULT false
    )`)
      await session.query(
        'ALTER TABLE "drizzle"."__drizzle_migrations" ADD COLUMN IF NOT EXISTS is_contract boolean NOT NULL DEFAULT false',
      )
      const latest = await session.query(
        'SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at',
      )
      const applied = new Set(latest.rows.map((row) => Number(row.created_at)))
      for (const row of latest.rows) {
        const file = files.find(
          (migration) => migration.folderMillis === Number(row.created_at),
        )
        if (!file) throw new ImageOlderThanDatabaseError(latest.rows.length, files.length)
        if (file.hash !== row.hash)
          throw new Error('Applied migration changed; restore its committed SQL')
      }
      // The auth adoption file is appended without moving immutable history.
      // Empty installs need it before the historical constructs referencing auth.
      const pending = files
        .filter((migration) => !applied.has(migration.folderMillis))
        .sort((a, b) => Number(b.prerequisite) - Number(a.prerequisite))
      for (const migration of pending) {
        if (migration.concurrentIndex) {
          const result = await buildConcurrentIndex(
            {
              query: async <TRow extends Record<string, unknown>>(
                text: string,
                values?: unknown[],
              ) => (await session.query(text, values)) as QueryResult<TRow>,
            },
            migration.concurrentIndex,
          )
          if (!result.ok) throw new ConcurrentIndexMigrationError(result.code)
          await recordConcurrentIndex(session, migration)
          continue
        }
        await applyTransactionalMigration(session, migration)
      }
    }),
  )
}
