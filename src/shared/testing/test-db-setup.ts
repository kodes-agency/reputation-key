// TestDbSetup (BQC-6.1) — create + migrate the isolated scratch database so a
// clean clone goes green without manual DB prep. Idempotent: when the deploy
// migration state is already present it verifies and exits fast (the
// integration project's vitest globalSetup runs this on every invocation).
//
// Apply sequence mirrors the ci.yml "Run migrations" trio (deploy order, see
// src/shared/db/CONTEXT.md):
//   1. pnpm auth:migrate  — Better Auth tables via the pinned runtime
//   2. pnpm db:migrate    — compatibility preflight + Drizzle journal track
//   3. Google Property binding concurrent-index sidecar
//   4. registered SQL sidecar — scripts/migrations/2026-07-06-permission-version-triggers.sql
// Both sidecars run outside the Drizzle migration transaction.
//
// Safety: the target passes validateTestDatabaseTarget (denylist + localhost
// required unless ALLOW_REMOTE_TEST_DB=1) BEFORE any connection is opened —
// this never creates or migrates a shared/remote database the lease guard
// would refuse.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { validateTestDatabaseTarget } from './test-environment-lease'
import { DEFAULT_TEST_DATABASE_URL, testEnvironment } from './test-environment'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const JOURNAL_URL = new URL('../../../drizzle/meta/_journal.json', import.meta.url)
const SIDECAR_URL = new URL(
  '../../../scripts/migrations/2026-07-06-permission-version-triggers.sql',
  import.meta.url,
)
const SIDECAR_MARKER_FUNCTION = 'bump_permission_version'
const TEST_DATABASE_PROVISIONING_LOCK_PREFIX = 'repkey-test-database-provisioning-v1'

export type TestDbSetupResult = Readonly<{
  databaseUrl: string
  /** The database (and possibly role) was created by this run. */
  created: boolean
  /** The migration sequence was applied by this run (false = fast-path skip). */
  migrated: boolean
  tableCount: number
  journalCount: number
}>

type DbState = Readonly<{
  tableCount: number
  journalCount: number
  hasAuthTables: boolean
  hasSidecar: boolean
  hasGooglePropertyBindingIndex: boolean
}>

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function redact(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@')
}

/** Same-database URL with the pathname swapped to the maintenance database. */
function maintenanceUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = '/postgres'
  return parsed.toString()
}

async function withPool<T>(url: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url, max: 2 })
  try {
    return await fn(pool)
  } finally {
    await pool.end()
  }
}

/**
 * Serialize the entire auth -> Drizzle -> sidecar sequence on one PostgreSQL
 * session. The staged Drizzle runner intentionally commits between its enum
 * prerequisite and the remaining journal, so transaction locks cannot protect
 * this boundary. A session lock also covers the separately spawned Better Auth
 * schema runner and index sidecar.
 */
export async function withTestDatabaseProvisioningLock<T>(
  client: Pick<PoolClient, 'query'>,
  operation: () => Promise<T>,
  lockName = TEST_DATABASE_PROVISIONING_LOCK_PREFIX,
): Promise<T> {
  await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName])

  let operationOutcome:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>
  try {
    operationOutcome = { ok: true, value: await operation() }
  } catch (error) {
    operationOutcome = { ok: false, error }
  }

  let releaseCompleted = false
  let releaseError: unknown
  try {
    const result = await client.query<{ released: boolean }>(
      'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
      [lockName],
    )
    if (result.rows[0]?.released !== true) {
      throw new Error('Test database provisioning advisory lock was not held')
    }
    releaseCompleted = true
  } catch (error) {
    releaseError = error
  }

  // Preserve the migration failure when cleanup also fails. Closing the
  // dedicated session below still releases every session advisory lock.
  if (!operationOutcome.ok) throw operationOutcome.error
  if (!releaseCompleted) throw releaseError
  return operationOutcome.value
}

async function withProvisioningSession<T>(
  url: string,
  operation: () => Promise<T>,
): Promise<T> {
  const targetDatabase = decodeURIComponent(new URL(url).pathname.slice(1))
  // Hold and wait for the provisioning gate in the maintenance database.
  // A waiter inside the target database retains a virtual transaction while
  // blocked; CREATE INDEX CONCURRENTLY must wait for that snapshot and would
  // deadlock with the lock holder. PostgreSQL advisory locks are shared by
  // contenders connected to this same maintenance database, while the target
  // remains free of waiting snapshots.
  const pool = new Pool({ connectionString: maintenanceUrl(url), max: 1 })
  let client: PoolClient | undefined
  try {
    client = await pool.connect()
    return await withTestDatabaseProvisioningLock(
      client,
      operation,
      `${TEST_DATABASE_PROVISIONING_LOCK_PREFIX}:${targetDatabase}`,
    )
  } finally {
    client?.release()
    await pool.end()
  }
}

/** Probe a connection; report the PostgreSQL error code on failure. */
async function probe(
  url: string,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  try {
    await withPool(url, (pool) => pool.query('SELECT 1'))
    return { ok: true }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return { ok: false, code: e.code, message: e.message }
  }
}

/**
 * Ensure the role + database from the URL exist. Clean-clone local PostgreSQL
 * (e.g. a fresh Homebrew install) has no `test` role: when auth fails the
 * role/database are bootstrapped via the OS superuser (local trust auth).
 */
async function ensureDatabaseExists(url: string): Promise<boolean> {
  const parsed = new URL(url)
  const dbName = decodeURIComponent(parsed.pathname.slice(1))
  const attempt = await probe(url)
  if (attempt.ok) return false
  if (attempt.code === '3D000') {
    try {
      await withPool(maintenanceUrl(url), (pool) =>
        pool.query(`CREATE DATABASE ${quoteIdent(dbName)}`),
      )
    } catch (error) {
      if (!isConcurrentDatabaseCreationError(error)) throw error
      const winner = await probe(url)
      if (!winner.ok) throw error
      return false
    }
    return true
  }
  if (attempt.code === '28P01' || attempt.code === '28000') {
    await bootstrapRoleAndDatabase(parsed, dbName)
    return true
  }
  throw new Error(
    `Cannot connect to ${redact(url)} (${attempt.code ?? 'no code'}: ${attempt.message}). ` +
      'Is PostgreSQL running?',
  )
}

/** PostgreSQL has reported both codes for two concurrent CREATE DATABASEs. */
export function isConcurrentDatabaseCreationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; constraint?: unknown }
  return (
    candidate.code === '42P04' ||
    (candidate.code === '23505' && candidate.constraint === 'pg_database_datname_index')
  )
}

async function bootstrapRoleAndDatabase(parsed: URL, dbName: string): Promise<void> {
  const role = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  const osAdminUrl = `postgresql://${userInfo().username}@${parsed.host}/postgres`
  await withPool(osAdminUrl, async (pool) => {
    const roleExists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      role,
    ])
    if (roleExists.rowCount === 0) {
      await pool.query(
        `CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD '${password.replace(/'/g, "''")}' CREATEDB`,
      )
    }
    await pool.query(`CREATE DATABASE ${quoteIdent(dbName)} OWNER ${quoteIdent(role)}`)
  })
}

function expectedJournalCount(): number {
  const journal = JSON.parse(readFileSync(JOURNAL_URL, 'utf8')) as { entries: unknown[] }
  return journal.entries.length
}

async function readState(url: string): Promise<DbState> {
  return withPool(url, async (pool) => {
    const state = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS table_count,
        (SELECT EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'user')) AS has_auth,
        (SELECT COALESCE(bool_and(i.indisvalid AND i.indisready AND i.indisunique), false)
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = 'properties_org_gbp_location_id_unique')
          AS has_google_property_binding_index,
        (SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '${SIDECAR_MARKER_FUNCTION}')) AS has_sidecar
    `)
    const journal = await pool
      .query('SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations"')
      .catch(() => ({ rows: [{ n: 0 }] }))
    const row = state.rows[0] as {
      table_count: number
      has_auth: boolean
      has_sidecar: boolean
      has_google_property_binding_index: boolean
    }
    return {
      tableCount: row.table_count,
      journalCount: (journal.rows[0] as { n: number }).n,
      hasAuthTables: row.has_auth,
      hasSidecar: row.has_sidecar,
      hasGooglePropertyBindingIndex: row.has_google_property_binding_index,
    }
  })
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stdin?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)),
    )
    if (stdin !== undefined) child.stdin.write(stdin)
    child.stdin.end()
  })
}

/** The ci.yml migration trio against the leased target (idempotent steps). */
async function applyMigrations(url: string): Promise<void> {
  const env = {
    ...testEnvironment(), // hermetic floor (BETTER_AUTH_SECRET, ...)
    ...process.env, // explicit shell/CI values win
    NODE_ENV: 'test',
    // Pin BOTH connection vars to the leased target — the schema config prefers
    // DATABASE_URL_POOLER and a developer .env must never redirect it.
    DATABASE_URL: url,
    DATABASE_URL_POOLER: url,
  } as NodeJS.ProcessEnv
  await run('pnpm', ['auth:migrate'], env)
  await run('pnpm', ['db:migrate'], env)
  await withPool(url, (pool) => pool.query(readFileSync(SIDECAR_URL, 'utf8')))
}

/**
 * Create the scratch database if missing and bring it to the deploy migration
 * state. Fast-path: when the Drizzle journal is complete and the auth/sidecar
 * markers are present, nothing is applied.
 *
 * @param urlOverride - explicit target; defaults to TEST_DATABASE_URL, then
 *   the canonical local scratch database (mirrors the testEnvironment builder).
 */
export async function ensureTestDatabase(
  urlOverride?: string,
): Promise<TestDbSetupResult> {
  const url = urlOverride ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL
  validateTestDatabaseTarget(url)

  const created = await ensureDatabaseExists(url)
  return withProvisioningSession(url, async () => {
    // Re-read only after acquiring the lock. A concurrent setup may have
    // completed while this caller was waiting; its journal is authoritative.
    const before = await readState(url)
    const upToDate =
      before.journalCount === expectedJournalCount() &&
      before.hasAuthTables &&
      before.hasGooglePropertyBindingIndex &&
      before.hasSidecar
    if (upToDate) {
      // Registered sidecars are intentionally idempotent and may evolve without
      // a new Drizzle journal entry. Production reapplies them on every deploy;
      // do the same on the integration fast path so a marker function cannot
      // make an older trigger definition look current.
      await withPool(url, (pool) => pool.query(readFileSync(SIDECAR_URL, 'utf8')))
      return {
        databaseUrl: url,
        created,
        migrated: false,
        tableCount: before.tableCount,
        journalCount: before.journalCount,
      }
    }

    await applyMigrations(url)
    const after = await readState(url)
    return {
      databaseUrl: url,
      created,
      migrated: true,
      tableCount: after.tableCount,
      journalCount: after.journalCount,
    }
  })
}
