// Runs an Inbox command in its own transaction, or as a savepoint inside a
// transaction the caller lends. A lent transaction rolls back with its owner.

import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'

export const inTransaction = <T>(
  db: Database,
  lent: Tx | undefined,
  run: (tx: Tx) => Promise<T>,
): Promise<T> => (lent ? lent.transaction(run) : db.transaction(run))
