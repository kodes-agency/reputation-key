// Atomic outbox commit helpers — single source of the expand-phase dual-path
// policy shared by every context command store (BQC-3.3/3.4/3.5, BQR-2.3).
//
// One PostgreSQL transaction per command: state mutation + outbox_events
// insert commit atomically. After commit, the in-process EventBus emit is
// best-effort: a bus failure must NOT roll back or hide the durable fact
// (the relay delivers when enabled).

import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { toOutboxEvent } from './event-adapter'

/** Drizzle transaction handle — the `tx` inside db.transaction(...). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Best-effort in-process emit after the atomic outbox commit. Expand-phase
 * dual path: the durable outbox row is already committed, so a bus failure
 * is logged and swallowed — it must not roll back or hide the durable fact
 * (the relay will deliver when enabled).
 */
export async function emitAfterCommit(
  events: EventBus,
  event: DomainEvent,
): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

/** Insert the durable outbox row for a domain event inside the command transaction. */
export async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}
