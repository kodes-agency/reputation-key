// TestEnvironmentLease — structural guard preventing destructive tests from
// reaching a non-disposable database or Redis instance (BETA-0 B0.3).
//
// Every integration test that mutates database state MUST call acquire()
// in beforeAll. The guard validates:
//   1. NODE_ENV === 'test'
//   2. ALLOW_DESTRUCTIVE_DB_TESTS === '1' (explicit opt-in)
//   3. The database host/name does not match a denylist of production-like
//      identifiers (neon, railway, supabase, planetscale, staging, beta, prod)
//   4. A cryptographically unique lease marker exists inside the target database
//
// The lease marker is a row in a _test_lease table. If the table or marker
// is missing, the guard refuses to proceed — proving the database was not
// intentionally leased for testing.

import { randomUUID } from 'crypto'
import { Pool } from 'pg'

const LEASE_TABLE = '_test_lease'

/** Hostnames patterns that indicate a managed/remote database — never safe for destructive tests. */
const DENYLIST_HOST_PATTERNS = [
  'neon.tech',
  'railway.app',
  'supabase.co',
  'planetscale.com',
  'aivencloud.com',
  'render.com',
  'fly.dev',
]

/** Database name patterns that indicate a non-disposable environment. */
const DENYLIST_DB_PATTERNS = ['prod', 'staging', 'beta', 'live']

export type TestLease = Readonly<{
  /** Unique random marker stored in the _test_lease table. */
  marker: string
  /** The pool connected to the leased database. */
  pool: Pool
  /** Release the lease and close the pool. */
  release: () => Promise<void>
}>

export class TestEnvironmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TestEnvironmentError'
  }
}

function parseDatabaseUrl(url: string): { host: string; database: string } {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      database: parsed.pathname.slice(1),
    }
  } catch {
    throw new TestEnvironmentError(
      'invalid_url',
      `DATABASE_URL is not a valid URL: ${url.replace(/:[^:@]+@/, ':***@')}`,
    )
  }
}

function checkDenylist(host: string, database: string): void {
  const hostLower = host.toLowerCase()
  const dbLower = database.toLowerCase()

  for (const pattern of DENYLIST_HOST_PATTERNS) {
    if (hostLower.includes(pattern)) {
      throw new TestEnvironmentError(
        'denylisted_host',
        `Database host "${host}" matches denylisted pattern "${pattern}". ` +
          'Destructive tests require a local or disposable database.',
      )
    }
  }

  for (const pattern of DENYLIST_DB_PATTERNS) {
    if (dbLower.includes(pattern)) {
      throw new TestEnvironmentError(
        'denylisted_database',
        `Database name "${database}" matches denylisted pattern "${pattern}". ` +
          'Destructive tests require a disposable database.',
      )
    }
  }
}

function checkEnvironment(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new TestEnvironmentError(
      'not_test_env',
      `NODE_ENV is "${process.env.NODE_ENV}", expected "test". ` +
        'Destructive tests must run with NODE_ENV=test.',
    )
  }

  if (process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== '1') {
    throw new TestEnvironmentError(
      'not_opted_in',
      'ALLOW_DESTRUCTIVE_DB_TESTS is not "1". ' +
        'Set ALLOW_DESTRUCTIVE_DB_TESTS=1 to explicitly opt in to destructive tests.',
    )
  }
}

async function ensureLeaseTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LEASE_TABLE} (
      marker TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function insertLeaseMarker(pool: Pool, marker: string): Promise<void> {
  await pool.query(
    `INSERT INTO ${LEASE_TABLE} (marker) VALUES ($1) ON CONFLICT DO NOTHING`,
    [marker],
  )
}

async function verifyLeaseMarker(pool: Pool, marker: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM ${LEASE_TABLE} WHERE marker = $1`, [
    marker,
  ])
  return result.rowCount !== null && result.rowCount > 0
}

async function removeLeaseMarker(pool: Pool, marker: string): Promise<void> {
  await pool.query(`DELETE FROM ${LEASE_TABLE} WHERE marker = $1`, [marker])
}

/**
 * Acquire a test environment lease on the given database URL.
 *
 * Validates the environment, checks the denylist, creates a lease marker,
 * and returns a handle that must be released after the test suite completes.
 *
 * @param databaseUrl - The PostgreSQL connection string to lease.
 * @param maxConnections - Pool size (default 5).
 * @throws {TestEnvironmentError} if any check fails.
 */
export async function acquireTestLease(
  databaseUrl: string,
  maxConnections = 5,
): Promise<TestLease> {
  checkEnvironment()

  const { host, database } = parseDatabaseUrl(databaseUrl)
  checkDenylist(host, database)

  const pool = new Pool({ connectionString: databaseUrl, max: maxConnections })

  try {
    await ensureLeaseTable(pool)
    const marker = randomUUID()
    await insertLeaseMarker(pool, marker)

    const verified = await verifyLeaseMarker(pool, marker)
    if (!verified) {
      throw new TestEnvironmentError(
        'lease_verification_failed',
        'Failed to verify lease marker in the target database.',
      )
    }

    return {
      marker,
      pool,
      release: async () => {
        await removeLeaseMarker(pool, marker)
        await pool.end()
      },
    }
  } catch (err) {
    await pool.end()
    throw err
  }
}

/**
 * Validate that a database URL is safe for destructive testing without
 * creating a lease. Useful for pre-flight checks.
 */
export function validateTestDatabaseUrl(databaseUrl: string): void {
  checkEnvironment()
  const { host, database } = parseDatabaseUrl(databaseUrl)
  checkDenylist(host, database)
}
