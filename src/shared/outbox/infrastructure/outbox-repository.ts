// Outbox repository — data access for outbox_events and event_consumer_receipts (PRE17A A3).
//
// The repository is the persistence boundary for the transactional outbox.
// Source contexts insert events atomically with their business write.
// The relay admits facts into the durable work ledger before enqueueing.
// Consumers check receipts before processing to ensure idempotency.
//
import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createOutboxDelivery } from './delivery.server'
import {
  eventConsumerReceipts,
  type ReceiptStatus,
} from '#/shared/db/schema/outbox.schema'
import { trace } from '#/shared/observability/trace'

// ── Types ───────────────────────────────────────────────────────────

export type UnpublishedEvent = Readonly<{
  id: string
  eventType: string
  eventVersion: number
  payload: unknown
  organizationId: string
  propertyId: string | null
  sourceContext: string
  sourceAggregateId: string
  /** BQC-3.7: row created_at — feeds the envelope's recordedAt. */
  recordedAt: Date
}>

export type DurableConsumerExpectation = Readonly<{
  eventType: string
  consumerName: string
}>

// ReceiptStatus lives in shared/db/schema/outbox.schema (single declaration,
// BQC-5.8) — re-exported here so the public barrel (#/shared/outbox) keeps
// surfacing it from the repository module.
export type { ReceiptStatus }

export type OutboxRepository = Readonly<{
  /** Check if a consumer has already processed an event. */
  hasReceipt: (eventId: string, consumerName: string) => Promise<boolean>
  /** Record a consumer receipt. */
  insertReceipt: (
    eventId: string,
    consumerName: string,
    status: ReceiptStatus,
  ) => Promise<void>
  delivery: ReturnType<typeof createOutboxDelivery>
  // BQC-1.6: outbox retention runs through the scheduled retention-sweep
  // (bounded CTE executor + evidence), replacing the unused invalid
  // DELETE...LIMIT methods that previously lived here.
}>

// ── Factory ─────────────────────────────────────────────────────────

export function createOutboxRepository(
  db: Database,
  clock: Clock = () => new Date(),
): OutboxRepository {
  return {
    delivery: createOutboxDelivery(db, clock),
    hasReceipt: async (eventId, consumerName) => {
      return trace('outbox.hasReceipt', async () => {
        const rows = await db
          .select({ eventId: eventConsumerReceipts.eventId })
          .from(eventConsumerReceipts)
          .where(
            and(
              eq(eventConsumerReceipts.eventId, eventId),
              eq(eventConsumerReceipts.consumerName, consumerName),
            ),
          )
          .limit(1)
        return rows.length > 0
      })
    },

    insertReceipt: async (eventId, consumerName, status) => {
      await trace('outbox.insertReceipt', async () => {
        await db
          .insert(eventConsumerReceipts)
          .values({ eventId, consumerName, status })
          .onConflictDoNothing()
      })
    },
  }
}
