// Scaffolding for tests that hold a statement at a known point so a second
// writer can be observed queueing behind it. A trigger on the table under test
// takes an advisory lock; the test holds that lock on a connection of its own,
// starts the writers, polls the catalogue until they queue, then commits the
// holder. The steps stay with the test: this only installs and tears down.

import type { Pool } from 'pg'

const POLL_INTERVAL_MS = 10
const POLL_TIMEOUT_MS = 5_000

export async function waitForDatabaseCondition(
  description: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

/** Sessions queued on the advisory lock `(lockClass, lockObject)`. */
export async function advisoryLockWaiters(
  pool: Pool,
  lockClass: number,
  lockObject: number,
): Promise<number> {
  const waits = await pool.query<{ waiters: number }>(
    `SELECT COUNT(*)::int AS waiters FROM pg_locks
      WHERE locktype = 'advisory' AND granted = false
        AND classid::bigint = $1 AND objid::bigint = $2`,
    [lockClass, lockObject],
  )
  return waits.rows[0]?.waiters ?? 0
}

/** Statements whose text matches `queryLike` and that are blocked by another session. */
export async function blockedStatements(pool: Pool, queryLike: string): Promise<number> {
  const waits = await pool.query<{ waiters: number }>(
    `SELECT COUNT(*)::int AS waiters FROM pg_stat_activity
      WHERE datname = current_database()
        AND cardinality(pg_blocking_pids(pid)) > 0
        AND query ILIKE $1`,
    [queryLike],
  )
  return waits.rows[0]?.waiters ?? 0
}

export type TriggerLockGateSpec = Readonly<{
  /** Names both the trigger and its function. */
  name: string
  table: string
  event: 'INSERT' | 'UPDATE'
  /** SQL condition on `NEW` that selects the row that must stop at the gate. */
  when: string
  lockClass: number
  lockObject: number
}>

export type TriggerLockGate = Readonly<{
  /** Registers work so the teardown settles it even when the test fails. */
  track<T>(work: Promise<T>): Promise<T>
  waitForQueued(description: string, count?: number): Promise<void>
  /** Commits the holder, letting the queued statement proceed. */
  commit(): Promise<void>
}>

/**
 * Installs a BEFORE trigger that parks the matching row on an advisory lock,
 * takes that lock on a held connection, and runs `run`. Always rolls back an
 * uncommitted holder, settles tracked work and drops the trigger.
 */
export async function withTriggerLockGate<T>(
  pool: Pool,
  spec: TriggerLockGateSpec,
  run: (gate: TriggerLockGate) => Promise<T>,
): Promise<T> {
  const { name, table, event, when, lockClass, lockObject } = spec
  const holder = await pool.connect()
  const pending: Promise<unknown>[] = []
  let isOpen = false
  try {
    await pool.query(`
      DROP TRIGGER IF EXISTS ${name} ON ${table};
      DROP FUNCTION IF EXISTS ${name}();
      CREATE FUNCTION ${name}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF ${when} THEN
          PERFORM pg_advisory_xact_lock(${lockClass}, ${lockObject});
        END IF;
        RETURN NEW;
      END;
      $function$;
      CREATE TRIGGER ${name}
        BEFORE ${event} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ${name}();
    `)
    await holder.query('BEGIN')
    isOpen = true
    await holder.query('SELECT pg_advisory_xact_lock($1, $2)', [lockClass, lockObject])
    return await run({
      track: (work) => {
        pending.push(work)
        return work
      },
      waitForQueued: (description, count = 1) =>
        waitForDatabaseCondition(
          description,
          async () => (await advisoryLockWaiters(pool, lockClass, lockObject)) === count,
        ),
      commit: async () => {
        await holder.query('COMMIT')
        isOpen = false
      },
    })
  } finally {
    if (isOpen) await holder.query('ROLLBACK')
    await Promise.allSettled(pending)
    holder.release()
    await pool.query(`
      DROP TRIGGER IF EXISTS ${name} ON ${table};
      DROP FUNCTION IF EXISTS ${name}();
    `)
  }
}
