// Predeploy migration runner (BQC-7.1) — Railway `preDeployCommand`
// (railway.json). Runs the deploy migration trio as ONE serialized,
// self-verifying step before the new web container starts serving.
//
// Apply order (the documented deploy order — src/shared/db/CONTEXT.md,
// drizzle.config.ts, mirrored by the ci.yml "Run migrations" step):
//   1. Better Auth track — getMigrations() from better-auth (the same code
//      `pnpm auth:migrate` wraps; the CLI only adds an interactive prompt).
//      Idempotent: creates only missing tables/columns.
//   2. Staged Drizzle journal track — apply through immutable migration 0033,
//      commit, autocommit cleanup_required, then apply 0034 onward. PostgreSQL
//      forbids using a new enum label in the transaction that added it.
//      `pnpm db:migrate` uses the same staged runner and journal bookkeeping.
//      Idempotent: applied journal entries and the enum label are skipped.
//   3. Google Property binding unique-index sidecar — duplicate-audited,
//      advisory-locked CREATE UNIQUE INDEX CONCURRENTLY outside Drizzle's
//      transactions.
//   4. Registered deploy SQL sidecar — scripts/migrations/
//      2026-07-06-permission-version-triggers.sql (idempotent by design;
//      plain SQL, no psql meta-commands, applied in-process via pg — the
//      same mechanism as src/shared/testing/test-db-setup.ts).
//
// SINGLE EXECUTION: a PostgreSQL session-level advisory lock
// (pg_advisory_lock, key = sha256('repkey-migrate-deploy')[:8]) serializes
// concurrent deploys — a second runner blocks on the lock until the first
// finishes, then converges instantly (every step is idempotent).
//
// FORWARD-RECOVERY POLICY: on ANY failure the script logs the failing step
// plus the reachable journal state and exits non-zero, so Railway blocks the
// deploy and keeps serving the previous container. Never roll the schema
// back mid-flight: fix the offending migration/sidecar SQL forward and
// redeploy — the trio's idempotency makes the rerun converge (runbooks.md
// §8). The only rollback path is PITR for data loss (runbooks.md §8).
//
// GUARD: refuses to run unless NODE_ENV=production (the deploy container
// sets it) or DEPLOY_MIGRATE=1 (explicit local/CI invocation). This script's
// whole point is remote production databases — the guard only prevents
// accidental no-flag runs against a developer's default DATABASE_URL.
//
// Region posture (ADR 0048): the deploy target is the single approved
// 'us' processing cell; the Railway region is a platform/dashboard setting
// (us-west2 / us-east4-eqdc4a), deliberately not pinned in railway.json.
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
import { buildGooglePropertyBindingIndex } from './google-property-binding-index'
import { runStagedDrizzleMigrations } from '../src/shared/db/staged-drizzle-migrator'

// dist-worker/migrate-deploy.js (built) and scripts/migrate-deploy.ts (tsx)
// both sit one level below the app root.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const JOURNAL_PATH = join(ROOT, 'drizzle/meta/_journal.json')
const MIGRATIONS_FOLDER = join(ROOT, 'drizzle')
const SIDECAR_PATH = join(
  ROOT,
  'scripts/migrations/2026-07-06-permission-version-triggers.sql',
)
const SIDECAR_MARKER_FUNCTION = 'bump_permission_version'

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
  if (process.env.NODE_ENV !== 'production' && process.env.DEPLOY_MIGRATE !== '1') {
    console.error(
      '[migrate-deploy] Refusing to run: set NODE_ENV=production (deploy ' +
        'containers) or DEPLOY_MIGRATE=1 (explicit local/CI run). This script ' +
        'migrates the database DATABASE_URL points at.',
    )
    process.exit(1)
  }

  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  // Deferred until after the guard: auth-cli.ts throws without
  // BETTER_AUTH_SECRET and builds the full auth instance at import time.
  const { auth } = await import('../src/shared/auth/auth-cli')
  const { getMigrations } = await import('better-auth/db/migration')

  const lockKey = advisoryLockKey()
  const client = new Client({ connectionString: url })
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

      // 2. Apply through 0033, commit the enum prerequisite, then apply the
      // remaining Drizzle journal entries.
      const stagedMigration = await runStagedDrizzleMigrations(client, MIGRATIONS_FOLDER)
      log('staged drizzle track applied', stagedMigration)

      // 3. Autocommit-only Google Property binding index gate
      const googlePropertyBindingIndex = await buildGooglePropertyBindingIndex(client)
      log('google property binding index', googlePropertyBindingIndex)
      if (!googlePropertyBindingIndex.ok) {
        throw new Error(
          `Google Property binding index denied: ${googlePropertyBindingIndex.code}`,
        )
      }

      // 4. Registered deploy SQL sidecar
      await client.query(readFileSync(SIDECAR_PATH, 'utf8'))
      log('sidecar applied', { file: SIDECAR_PATH.split('/').pop() })

      // Verify the deploy migration state (self-maintaining expectations —
      // the journal file on disk is the reference, not a hardcoded count).
      const state = await client.query(`
        SELECT
          (SELECT count(*)::int FROM information_schema.tables
            WHERE table_schema = 'public') AS table_count,
          (SELECT EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'user')) AS has_auth,
          (SELECT EXISTS (SELECT 1 FROM pg_proc
            WHERE proname = '${SIDECAR_MARKER_FUNCTION}')) AS has_sidecar
      `)
      const journal = await readJournalState(client)
      const row = state.rows[0] as {
        table_count: number
        has_auth: boolean
        has_sidecar: boolean
      }
      const complete =
        row.has_auth && row.has_sidecar && journal.applied === expectedJournalCount()
      log('migration state', {
        tableCount: row.table_count,
        journalApplied: journal.applied,
        journalExpected: expectedJournalCount(),
        hasAuthTables: row.has_auth,
        hasSidecar: row.has_sidecar,
      })
      if (!complete) {
        throw new Error(
          'Migration state incomplete after the trio — see the state line above. ' +
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
      '[migrate-deploy] Forward recovery: fix the failing migration/sidecar SQL ' +
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
