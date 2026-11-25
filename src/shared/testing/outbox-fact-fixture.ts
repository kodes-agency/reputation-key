// Durable facts for suites that need a real outbox row (a delivered source
// event that consumer receipts point at). Written the way a command store
// writes them, so a row here matches one production produces.

import type { Database } from '#/shared/db'
import type { DomainEvent } from '#/shared/events/events'
import { runWithContext } from '#/shared/observability/request-context'
import { insertOutboxRow } from '#/shared/outbox/commit'

const TEST_REQUEST_ID = 'test-request'
const TEST_REQUEST_IDENTIFIERS = Object.freeze({
  causationId: 'test-causation',
  commandId: 'test-command',
})

/**
 * Record a durable fact with `insertOutboxRow` inside a transaction and a
 * request context: the row carries the request's causation and command
 * identifiers, and a guest fact takes the metric-source lock.
 */
export async function recordOutboxFact(db: Database, fact: DomainEvent): Promise<void> {
  await runWithContext(
    TEST_REQUEST_ID,
    () => db.transaction((tx) => insertOutboxRow(tx, fact)),
    TEST_REQUEST_IDENTIFIERS,
  )
}
