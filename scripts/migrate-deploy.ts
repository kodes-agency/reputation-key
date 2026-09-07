// Predeploy migration runner (BQC-7.1) — Railway's `preDeployCommand`,
// configured in `railway.json`. Runs both schema tracks and provider-subject
// initialization as ONE serialized, self-verifying step before serving.
//
// Apply order (the documented deploy order — src/shared/db/CONTEXT.md,
// drizzle.config.ts, mirrored by the ci.yml "Run migrations" step):
//   1. Better Auth track — getMigrations() from better-auth (the same code
//      `pnpm auth:migrate` wraps through the repository-pinned schema runner).
//      Idempotent: creates only missing tables/columns.
//   2. Drizzle journal track — applies the baseline, DB-only constructs, and
//      control-plane seed. `pnpm db:migrate` uses the same journal bookkeeping.
//
// SINGLE EXECUTION: a PostgreSQL session-level advisory lock
// (pg_advisory_lock, key = sha256('repkey-migrate-deploy')[:8]) serializes
// concurrent deploys — a second runner blocks on the lock until the first
// finishes, then converges instantly (every step is idempotent).
//
// FORWARD-RECOVERY POLICY: on ANY failure the script logs the failing step
// plus the reachable journal state and exits non-zero, so Railway blocks the
// deploy and keeps serving the previous container. Never roll the schema
// back mid-flight: fix the offending migration forward and redeploy — both
// tracks are idempotent, so the rerun converges (runbooks.md
// §8). The only rollback path is PITR for data loss (runbooks.md §8).
//
// GUARD: Railway runs prove their exact built-in project, environment, and
// service identity before DATABASE_URL is opened. Only cell-us and the
// schema-migrator/web services are migration authorities. DEPLOY_MIGRATE=1 is
// the explicit local/CI bypass for disposable database verification.
//
// Region posture (ADR 0057): beta deploys only logical cell 'us'. The checked-in
// TypeScript Railway graph pins compute to US West/California `us-west2` and
// the bucket to `sjc`; this runner applies the journal only inside `cell-us`.
//
// Local verification (scratch database):
//   NODE_ENV=production DEPLOY_MIGRATE=1 DATABASE_URL=postgresql://... \
//     BETTER_AUTH_SECRET=... pnpm db:migrate-deploy

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client, type Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { authorizeDeployMigrationRuntime } from '../src/shared/db/deploy-migration-runtime'
import { initializeReviewProviderSubjectKeyInventoryFromEnvironment } from '../src/contexts/review/infrastructure/provider-subject-key-initializer'

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

async function main(): Promise<void> {
  // The throw is the fail-closed deploy guard; nothing downstream reads the
  // resolved runtime any more.
  authorizeDeployMigrationRuntime(process.env)

  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  // Deferred until after the guard: the schema config throws without
  // BETTER_AUTH_SECRET and builds the full auth instance at import time.
  const { auth } = await import('../src/shared/auth/auth-cli')
  const { getMigrations } = await import('better-auth/db/migration')

  const lockKey = advisoryLockKey()
  const client = new Client({ connectionString: url })
  const migrationDb = drizzle(client)
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey.toString()])
    log('advisory lock acquired', { key: lockKey.toString() })
    try {
      // 1. Better Auth track
      const authMigrations = await getMigrations(auth.options)
      log('auth track pending', {
        toBeCreated: authMigrations.toBeCreated.length,
        toBeAdded: authMigrations.toBeAdded.length,
      })
      await authMigrations.runMigrations()
      log('auth track applied')

      // 2. Apply the three-entry Drizzle journal: baseline, DB-only constructs,
      // and control-plane seed.
      await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER })
      log('drizzle track applied')

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
      const complete =
        row.has_auth &&
        row.has_provider_subject_key &&
        journal.applied === expectedJournalCount()
      log('migration state', {
        tableCount: row.table_count,
        journalApplied: journal.applied,
        journalExpected: expectedJournalCount(),
        hasAuthTables: row.has_auth,
        hasProviderSubjectKey: row.has_provider_subject_key,
      })
      if (!complete) {
        throw new Error(
          'Migration state incomplete after the schema tracks — see the state line above. ' +
            'Fix forward and redeploy; the rerun converges.',
        )
      }
      log('OK — deploy migration state reached')
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey.toString()])
      log('advisory lock released')
    }
  } catch (err) {
    const journal = await readJournalState(client).catch(() => ({
      applied: 'unreachable',
    }))
    console.error('[migrate-deploy] FAILED', err)
    console.error('[migrate-deploy] journal state at failure:', JSON.stringify(journal))
    console.error(
      '[migrate-deploy] Forward recovery: fix the failing migration SQL ' +
        'and redeploy — every step is idempotent, the rerun converges. ' +
        'Do NOT hand-roll partial schema state (runbooks.md §8).',
    )
    process.exitCode = 1
  } finally {
    await client.end()
    // auth-cli.ts creates a Pool at import time (auth.options.database) —
    // end it or the process hangs after the work is done.
    await (auth.options.database as Pool | undefined)?.end()
  }
}

await main()
