// The lock wait of the deploy migrator's journal track (scripts/migrate-deploy.ts).
//
// A statement that waits for a lock keeps its request queued, and PostgreSQL
// queues every later request on the same object behind it. A migration's
// `ALTER TABLE` waiting on one long query therefore stalls every application
// statement on that table. The pool bounds each application wait at
// SESSION_LOCK_TIMEOUT_MS (10 s, pool.ts) and fails the statement; the
// migrator had no bound, so it kept the queue in place for as long as the
// holder ran. With this bound the migrator gives up first and the deploy
// fails, which leaves the previous release serving an unchanged schema.
//
// What it does not bound is how long the migrator HOLDS a lock: drizzle
// applies every pending file in one transaction, so the first file's locks
// are kept until the last file's statements finish. An application statement
// waiting on one of them is failed by its own 10 s bound.

/** Below the application's bound, so sessions queued behind the migrator are released first. */
export const MIGRATION_LOCK_TIMEOUT_MS = 5_000

/** SQLSTATE `lock_not_available`: what a statement cancelled by `lock_timeout` raises. */
const LOCK_NOT_AVAILABLE = '55P03'

type MigrationSession = Readonly<{ query: (text: string) => Promise<unknown> }>

/**
 * Applies the journal with the lock wait bounded, then lifts the bound: the
 * concurrent-index sidecar runs next on the same session, and
 * `CREATE INDEX CONCURRENTLY` may rightly wait for an old transaction longer
 * than a migration may wait for a lock.
 *
 * A failure leaves the bound set, and deliberately has no `finally`: the
 * runner reads the journal state next on this session, which must not hang on
 * the lock that just failed the journal, and a reset sent on a broken
 * connection would replace the failure worth reading.
 */
export async function withMigrationLockTimeout<T>(
  session: MigrationSession,
  applyJournal: () => Promise<T>,
): Promise<T> {
  await session.query(`SET lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`)
  const applied = await applyJournal()
  await session.query('RESET lock_timeout')
  return applied
}

/** True when the failure is, or wraps, a statement cancelled by `lock_timeout`. */
export function isMigrationLockTimeout(failure: unknown): boolean {
  if (typeof failure !== 'object' || failure === null) return false
  const { code, cause } = failure as { code?: unknown; cause?: unknown }
  return code === LOCK_NOT_AVAILABLE || isMigrationLockTimeout(cause)
}
