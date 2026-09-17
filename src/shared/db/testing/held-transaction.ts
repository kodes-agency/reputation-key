// One suite-long transaction that always rolls back, for integration fixtures
// that must never be committed (goal_monthly_results, for example, can't be
// deleted afterwards: guard_goal_monthly_result_v1 rejects every DELETE).

import { TransactionRollbackError, type Logger } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'

export type HeldTransaction = Readonly<{
  /** The connection the transaction is open on. Write fixture SQL with it. */
  client: Client
  /** Hand this to the code under test. */
  db: Database
  /** Rolls back everything written through `client` or `db`, then disconnects. */
  rollBack: () => Promise<void>
}>

/**
 * Opens a transaction on a dedicated connection and holds it until `rollBack`.
 *
 * `db` is that drizzle transaction, so a `transaction()` the code under test
 * opens becomes a SAVEPOINT inside it. Don't go back to `pool.query('BEGIN')`
 * with `drizzle(pool)`: drizzle's pool transaction sends a second BEGIN on the
 * same connection, Postgres ignores it, and that transaction's COMMIT commits
 * the fixture (or its ROLLBACK wipes it).
 */
export async function holdTransaction(
  options: Readonly<{ logger?: Logger }> = {},
): Promise<HeldTransaction> {
  const client = new Client({ connectionString: getEnv().DATABASE_URL })
  await client.connect()

  const opened = Promise.withResolvers<Database>()
  const released = Promise.withResolvers<void>()
  const transaction = drizzle(client, { schema, logger: options.logger }).transaction(
    async (tx) => {
      opened.resolve(tx as unknown as Database)
      await released.promise
      tx.rollback()
    },
  )
  transaction.catch(opened.reject)

  let db: Database
  try {
    db = await opened.promise
  } catch (error) {
    await client.end()
    throw error
  }

  return {
    client,
    db,
    async rollBack() {
      released.resolve()
      try {
        await transaction.catch((error: unknown) => {
          if (!(error instanceof TransactionRollbackError)) throw error
        })
      } finally {
        await client.end()
      }
    },
  }
}
