// Atomic outbox commit helpers shared by every context command store
// (BQC-3.3/3.4/3.5, BQR-2.3).
//
// One PostgreSQL transaction per command: state mutation + outbox_events
// insert commit atomically. The row is the fact; the worker relay delivers it.

import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { DomainEvent } from '#/shared/events/events'
import { getRequestContext } from '#/shared/observability/request-context'
import { toOutboxEvent, withEnvelopeIdentifiers } from './event-adapter'

/** Drizzle transaction handle — the `tx` inside db.transaction(...). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Insert the durable outbox row for a domain event inside the command transaction. */
export async function insertOutboxRow(
  tx: Tx,
  event: DomainEvent,
  options: Readonly<{ recordedAt?: Date }> = {},
): Promise<void> {
  const contextualEvent = withEnvelopeIdentifiers(event, getRequestContext())
  await tx.insert(outboxEvents).values({
    ...toOutboxEvent(contextualEvent),
    id: event.eventId,
    ...(options.recordedAt ? { createdAt: options.recordedAt } : {}),
  })
}

/**
 * Insert a durable fact unless its deterministic event id already exists.
 * Returns true only for the transaction that first records the fact.
 */
export async function insertOutboxRowIfNew(
  tx: Tx,
  event: DomainEvent,
  options: Readonly<{ recordedAt?: Date }> = {},
): Promise<boolean> {
  const contextualEvent = withEnvelopeIdentifiers(event, getRequestContext())
  const rows = await tx
    .insert(outboxEvents)
    .values({
      ...toOutboxEvent(contextualEvent),
      id: event.eventId,
      ...(options.recordedAt ? { createdAt: options.recordedAt } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: outboxEvents.id })
  return rows.length === 1
}
