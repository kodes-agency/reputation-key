// Applies committed schema history, Better Auth's tables and concurrent indexes
// included, under one deployment advisory lock, then initializes provider keys
// and the declared capability posture. A failed file leaves earlier files
// durable; a rerun resumes from the journal.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client, type Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrateJournal } from '../src/shared/db/migrate-journal.server'
import { authorizeDeployMigrationRuntime } from '../src/shared/db/deploy-migration-runtime'
import {
  deployFailureRecovery,
  deployMigrationStateRefusal,
  ImageOlderThanDatabaseError,
} from '../src/shared/db/migration-journal-state'
import { initializeReviewProviderSubjectKeyInventoryFromEnvironment } from '../src/contexts/review/infrastructure/provider-subject-key-initializer'
import type { Database } from '../src/shared/db'
import {
  formatDeclaredCapabilityPostureReport,
  parseDeclaredCapabilityPosture,
  type DeclaredCapabilityPosture,
} from '../src/shared/release/declared-capability-posture'
import {
  applyDeclaredCapabilityPosture,
  createDeclaredCapabilityPostureStores,
} from '../src/composition/declared-capability-posture'

// dist-worker/migrate-deploy.js (built) and scripts/migrate-deploy.ts (tsx)
// both sit one level below the app root.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const JOURNAL_PATH = join(ROOT, 'drizzle/meta/_journal.json')
const MIGRATIONS_FOLDER = join(ROOT, 'drizzle')

/** Stable signed int64 advisory-lock key derived from a constant string. */
function advisoryLockKey(): bigint {
  const hex = createHash('sha256').update('repkey-migrate-deploy').digest('hex')
  const unsigned = BigInt(`0x${hex.slice(0, 16)}`)
  return unsigned >= 2n ** 63n ? unsigned - 2n ** 64n : unsigned
}

function expectedJournalCount(): number {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
    entries: unknown[]
  }
  return journal.entries.length
}

function log(step: string, detail?: Record<string, unknown>): void {
  console.log(`[migrate-deploy] ${step}${detail ? ` ${JSON.stringify(detail)}` : ''}`)
}

async function readJournalState(client: Client): Promise<Record<string, unknown>> {
  try {
    const result = await client.query(
      'SELECT count(*)::int AS applied, max(created_at)::text AS last FROM "drizzle"."__drizzle_migrations"',
    )
    return result.rows[0] as Record<string, unknown>
  } catch {
    return { applied: 'unreachable' }
  }
}

/** The declared posture, or null after reporting why the deploy refuses it. */
function readDeclaredCapabilityPosture(): DeclaredCapabilityPosture | null {
  try {
    return parseDeclaredCapabilityPosture(process.env)
  } catch (err) {
    console.error(
      `[declared-posture] refused before migrating: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exitCode = 1
    return null
  }
}

/**
 * The journal owns Better Auth's tables. A pinned runtime that expects a table
 * or column the journal does not create would fail requests, so the deploy
 * stops until a migration adds it. Imported only now: the schema runner reads
 * whether the auth tables exist yet when it is constructed.
 */
async function assertBetterAuthSchemaCurrent(): Promise<void> {
  const { auth } = await import('../src/shared/auth/auth-cli')
  const { getMigrations } = await import('better-auth/db/migration')
  try {
    const pending = await getMigrations(auth.options)
    const tables = pending.toBeCreated.map((table) => table.table)
    const columns = pending.toBeAdded.flatMap((table) =>
      Object.keys(table.fields).map((field) => `${table.table}.${field}`),
    )
    log('better auth schema', { missingTables: tables, missingColumns: columns })
    if (tables.length > 0 || columns.length > 0) {
      throw new Error(
        'The pinned Better Auth expects tables or columns the journal does not create; add a migration for them',
      )
    }
  } finally {
    await (auth.options.database as Pool | undefined)?.end()
  }
}

/**
 * A failure here happens with the schema already current, so it gets
 * its own recovery line rather than the migration one; the step still fails,
 * so the deploy is not promoted dark.
 */
async function applyDeclaredCapabilityPostureStep(
  db: Database,
  posture: DeclaredCapabilityPosture,
): Promise<void> {
  try {
    const report = await applyDeclaredCapabilityPosture({
      stores: createDeclaredCapabilityPostureStores(db),
      posture,
      now: new Date(),
    })
    console.log(formatDeclaredCapabilityPostureReport(report))
  } catch (err) {
    console.error('[declared-posture] FAILED', err)
    console.error(
      '[declared-posture] The schema is current; only the capability controls are ' +
        'unresolved. Read the error, fix the control state (runbooks.md §25) and ' +
        'redeploy — the step is idempotent.',
    )
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  // The throw is the fail-closed deploy guard; nothing downstream reads the
  // resolved runtime any more.
  authorizeDeployMigrationRuntime(process.env)

  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  // Read before any migration, so a mistyped capability name refuses the
  // deploy while the schema is still untouched.
  const posture = readDeclaredCapabilityPosture()
  if (!posture) return

  const lockKey = advisoryLockKey()
  const client = new Client({ connectionString: url })
  const migrationDb = drizzle(client)
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey.toString()])
    log('advisory lock acquired', { key: lockKey.toString() })
    try {
      await migrateJournal(client, MIGRATIONS_FOLDER)
      log('journal applied')

      await assertBetterAuthSchemaCurrent()

      await initializeReviewProviderSubjectKeyInventoryFromEnvironment({
        db: migrationDb,
        env: process.env,
      })
      log('review provider subject key inventory initialized')

      // Verify the deploy migration state (self-maintaining expectations —
      // the journal file on disk is the reference, not a hardcoded count).
      const state = await client.query(`
        SELECT
          (SELECT count(*)::int FROM information_schema.tables
            WHERE table_schema = 'public') AS table_count,
          (SELECT EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'user')) AS has_auth,
          (SELECT count(*) = 1
            FROM review_provider_subject_hmac_key_versions
            WHERE state = 'active') AS has_provider_subject_key
      `)
      const journal = await readJournalState(client)
      const row = state.rows[0] as {
        table_count: number
        has_auth: boolean
        has_provider_subject_key: boolean
      }
      const journalExpected = expectedJournalCount()
      log('migration state', {
        tableCount: row.table_count,
        journalApplied: journal.applied,
        journalExpected,
        hasAuthTables: row.has_auth,
        hasProviderSubjectKey: row.has_provider_subject_key,
      })
      // An older migration authority cannot mutate a newer database.
      const refusal = deployMigrationStateRefusal({
        applied: typeof journal.applied === 'number' ? journal.applied : null,
        journalEntries: journalExpected,
        hasAuthTables: row.has_auth,
        hasProviderSubjectKey: row.has_provider_subject_key,
      })
      if (refusal) throw refusal
      log('OK — deploy migration state reached')

      // Declared capability posture, still under the deploy lock. Its
      // stores only issue queries and transactions, which drizzle runs on this
      // Client exactly as on the app's Pool.
      await applyDeclaredCapabilityPostureStep(
        migrationDb as unknown as Database,
        posture,
      )
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey.toString()])
      log('advisory lock released')
    }
  } catch (err) {
    const journal = await readJournalState(client).catch(() => ({
      applied: 'unreachable',
    }))
    if (err instanceof ImageOlderThanDatabaseError) {
      log('migration state', {
        journalApplied: journal.applied,
        journalExpected: expectedJournalCount(),
      })
    }
    console.error('[migrate-deploy] FAILED', err)
    console.error('[migrate-deploy] journal state at failure:', JSON.stringify(journal))
    console.error(`[migrate-deploy] ${deployFailureRecovery(err)}`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

await main()
