// Predeploy migration runner (BQC-7.1) — Railway's `preDeployCommand`,
// configured in `railway.json`. Runs the deploy migration trio as ONE
// serialized, self-verifying step before the new web container starts serving.
//
// Apply order (the documented deploy order — src/shared/db/CONTEXT.md,
// drizzle.config.ts, mirrored by the ci.yml "Run migrations" step):
//   1. Better Auth track — getMigrations() from better-auth (the same code
//      `pnpm auth:migrate` wraps through the repository-pinned schema runner).
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
import { bindSingleUsDataCellCutoverTarget } from '../src/shared/db/single-us-data-cell-target-binding'
import { initializeReviewProviderSubjectKeyInventoryFromEnvironment } from '../src/contexts/review/infrastructure/provider-subject-key-initializer'
import {
  AI_ADMISSION_PUBLIC_PROCEDURES,
  sidecarFunctionIsolationSql,
} from '../src/shared/db/sidecar-function-isolation'

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
/** The non-superuser role whose EXECUTE surface the isolation readback reports. */
const AI_ADMISSION_ROLE = 'repkey_ai_admission_local'

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
  const runtime = authorizeDeployMigrationRuntime(process.env)

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

      // 2. Apply the Drizzle journal. Two entries now: the regenerated
      // baseline and the DB-only constructs. The staged migrator existed only
      // to replay 182 historical migrations onto a populated database — a tag
      // cutoff at 0033, three enum preflights between batches and a
      // review-source backfill. None of that has meaning against a baseline,
      // and every environment starts empty.
      await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER })
      log('drizzle track applied')

      // Migration 0140 creates an unbound, open singleton. The first signed
      // Railway migrator atomically binds it to Railway's platform-provided
      // opaque target IDs; exact reruns (including web predeploy) are no-ops,
      // while a copied/misdirected database is refused.
      if (runtime.mode === 'railway') {
        await bindSingleUsDataCellCutoverTarget(migrationDb, {
          projectId: runtime.projectId,
          environmentId: runtime.environmentId,
        })
        log('single-US Data Cell target bound', {
          deploymentProfile: runtime.deploymentProfile,
          service: runtime.service,
        })
      }

      // 4. Registered deploy SQL sidecar
      await client.query(readFileSync(SIDECAR_PATH, 'utf8'))
      log('sidecar applied', { file: SIDECAR_PATH.split('/').pop() })

      // 4b. Restore the AI admission isolation posture.
      //
      // Every function created or replaced above carries PostgreSQL's default
      // EXECUTE grant to PUBLIC, and the AI admission readiness predicate
      // refuses to start if its role can execute anything in `public` beyond
      // its own five procedures. On 2026-09-01 a deploy left 51 executable
      // where 5 are allowed and both AI sidecars stopped booting. Runs after
      // the schema work, every deploy, because a one-off revoke lasts only
      // until the next migration recreates a function.
      await client.query(sidecarFunctionIsolationSql())
      // Joined against pg_roles rather than passing the name to
      // has_function_privilege directly: that function RAISES for an unknown
      // role, and the role is absent in local and CI databases. No rows there
      // means the readback logs null instead of failing the deploy.
      const isolation = await client.query<{ executable: number }>(
        `SELECT (
            SELECT count(*)::int
              FROM pg_proc AS p
             WHERE p.pronamespace = 'public'::regnamespace
               AND has_function_privilege(role.oid, p.oid, 'EXECUTE')
          ) AS executable
           FROM pg_roles AS role
          WHERE role.rolname = $1`,
        [AI_ADMISSION_ROLE],
      )
      log('sidecar function isolation', {
        role: AI_ADMISSION_ROLE,
        executable: isolation.rows[0]?.executable ?? null,
        allowed: AI_ADMISSION_PUBLIC_PROCEDURES.length,
      })
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
          (SELECT EXISTS (SELECT 1 FROM pg_proc
            WHERE proname = '${SIDECAR_MARKER_FUNCTION}')) AS has_sidecar,
          (SELECT count(*) = 1
            FROM review_provider_subject_hmac_key_versions
            WHERE state = 'active') AS has_provider_subject_key
      `)
      const journal = await readJournalState(client)
      const row = state.rows[0] as {
        table_count: number
        has_auth: boolean
        has_sidecar: boolean
        has_provider_subject_key: boolean
      }
      const complete =
        row.has_auth &&
        row.has_sidecar &&
        row.has_provider_subject_key &&
        journal.applied === expectedJournalCount()
      log('migration state', {
        tableCount: row.table_count,
        journalApplied: journal.applied,
        journalExpected: expectedJournalCount(),
        hasAuthTables: row.has_auth,
        hasSidecar: row.has_sidecar,
        hasProviderSubjectKey: row.has_provider_subject_key,
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
