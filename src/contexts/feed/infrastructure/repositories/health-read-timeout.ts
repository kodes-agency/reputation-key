// Feed notification surface — the server-side budget of the health reads.
//
// The operations snapshot stops waiting for a health signal at its own
// per-signal cap, but a query it has given up on keeps running: the
// delivery-lag linkage scan once ran for 4–13 s, holding a pool connection and
// database CPU on every five-minute evaluation. These reads therefore also
// carry a PostgreSQL statement timeout, so the database stops working for a
// caller that has gone.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

/**
 * Statement timeout for the notification health reads (gap count and
 * delivery lag). Under the operations snapshot's per-signal cap
 * (OPS_HEALTH_SIGNAL_BUDGET_MS, 2.5 s), so one stalled statement is cancelled
 * by PostgreSQL no later than the snapshot stops waiting for it.
 */
export const NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS = 2_000

/** PostgreSQL's query_canceled, raised when statement_timeout fires. */
const QUERY_CANCELED = '57014'

/**
 * A notification health read PostgreSQL cancelled at its statement timeout.
 * Content-free: the name and code are what the health span logs.
 */
export class NotificationHealthReadTimeoutError extends Error {
  override readonly name = 'NotificationHealthReadTimeoutError'
  readonly code = 'statement_timeout'

  constructor(readonly statementTimeoutMs: number) {
    super(
      `notification health read exceeded its ${statementTimeoutMs}ms statement timeout`,
    )
  }
}

/** Drizzle wraps the driver error, so the PostgreSQL code is on a cause. */
function isStatementTimeout(error: unknown): boolean {
  let current: unknown = error
  for (
    let depth = 0;
    depth < 3 && typeof current === 'object' && current !== null;
    depth++
  ) {
    if ((current as { code?: unknown }).code === QUERY_CANCELED) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Rejects a timeout that is not a positive whole number of milliseconds. */
export function assertStatementTimeoutMs(statementTimeoutMs: number): void {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1) {
    throw new Error(
      'notification health read statementTimeoutMs must be a positive integer',
    )
  }
}

/**
 * Run a health read in one read-only transaction whose statements PostgreSQL
 * cancels after `statementTimeoutMs` each (`set_config(..., true)` is local to
 * the transaction, so the pooled connection never keeps it). A cancelled
 * statement aborts the transaction, so the read's later statements never run,
 * and the read rejects with NotificationHealthReadTimeoutError.
 */
export async function withHealthReadTimeout<T>(
  db: Database,
  statementTimeoutMs: number,
  read: (transaction: Database) => Promise<T>,
): Promise<T> {
  assertStatementTimeoutMs(statementTimeoutMs)
  try {
    return await db.transaction(
      async (transaction) => {
        await transaction.execute(
          sql`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`,
        )
        return read(transaction as unknown as Database)
      },
      { accessMode: 'read only' },
    )
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new NotificationHealthReadTimeoutError(statementTimeoutMs)
    }
    throw error
  }
}
