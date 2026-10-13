// Inbox context — consumer receipt rows.
//
// The (event, consumer) receipt is what makes a durable delivery apply once:
// the dispatcher skips a delivery that has one, and an apply transaction
// commits its receipt with the state it changed. These are the row writes the
// Inbox command store composes inside those transactions.

import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { ApplyReceiptStatus } from '../application/ports/inbox-command-store.port'

export async function insertReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
  status: ApplyReceiptStatus,
): Promise<void> {
  await tx
    .insert(eventConsumerReceipts)
    .values({ eventId, consumerName, status })
    .onConflictDoNothing()
}

/** Reserve a delivery inside the apply transaction. A concurrent duplicate
 * blocks on the receipt key and then observes no returned row, so it cannot
 * repeat a close/reopen after a later workflow transition. */
export async function reserveReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
): Promise<boolean> {
  const rows = await tx
    .insert(eventConsumerReceipts)
    .values({ eventId, consumerName, status: 'applied' })
    .onConflictDoNothing()
    .returning({ eventId: eventConsumerReceipts.eventId })
  return rows.length === 1
}

/** Say what a reserved delivery turned out to be, once the transaction knows. */
export async function restateReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
  status: ApplyReceiptStatus,
): Promise<void> {
  await tx
    .update(eventConsumerReceipts)
    .set({ status })
    .where(
      and(
        eq(eventConsumerReceipts.eventId, eventId),
        eq(eventConsumerReceipts.consumerName, consumerName),
      ),
    )
}

/**
 * Settle as obsolete a delivery that a later fact supersedes, unless its
 * consumer already settled it. The insert takes the same receipt key the
 * consumer's apply transaction reserves first, so the two cannot both win:
 * either this row lands and the consumer's reservation is refused, or the
 * consumer holds the key and this statement waits for its commit and then
 * changes nothing, with whatever the consumer applied now visible.
 *
 * An event that is no longer stored cannot be delivered again and takes no
 * receipt (the receipt's foreign key would refuse one).
 */
export async function settleSupersededDeliveryRow(
  db: Database,
  eventId: string,
  consumerName: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
    SELECT ${eventId}::uuid, ${consumerName}, 'obsolete'
    WHERE EXISTS (SELECT 1 FROM outbox_events WHERE id = ${eventId}::uuid)
    ON CONFLICT DO NOTHING
  `)
}
