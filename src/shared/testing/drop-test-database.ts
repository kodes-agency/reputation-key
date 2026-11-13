// Drop a disposable test database once the sessions of its closed pools are gone.
//
// `pool.end()` resolves as soon as each client has sent its Terminate message,
// not when the backend has exited. A `DROP DATABASE ... WITH (FORCE)` issued in
// that window signals a backend that is still shutting down, and PostgreSQL
// reports it to the already-ended client as 57P01. The pool has dropped its
// error listener by then, so the report surfaces as an uncaught exception in
// whichever test file happens to be running.

import type { Pool } from 'pg'

const SESSIONS_CLOSE_TIMEOUT_MS = 10_000
const SESSIONS_POLL_INTERVAL_MS = 25

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function otherSessions(
  maintenance: Pick<Pool, 'query'>,
  database: string,
): Promise<number> {
  const result = await maintenance.query<{ sessions: number }>(
    'SELECT count(*)::int AS sessions FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [database],
  )
  return result.rows[0]?.sessions ?? 0
}

/**
 * Wait (bounded) for every session on `database` to exit, then drop it. Sessions
 * still open after the wait are forced closed, as before.
 */
export async function dropTestDatabase(
  maintenance: Pick<Pool, 'query'>,
  database: string,
): Promise<void> {
  const deadline = Date.now() + SESSIONS_CLOSE_TIMEOUT_MS
  while (Date.now() < deadline && (await otherSessions(maintenance, database)) > 0) {
    await delay(SESSIONS_POLL_INTERVAL_MS)
  }
  await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`)
}
