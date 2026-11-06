// Outbox repository — data access for outbox_events and event_consumer_receipts (PRE17A A3).
//
// The repository is the persistence boundary for the transactional outbox.
// Source contexts insert events atomically with their business write.
// The relay admits facts into the durable work ledger before enqueueing.
// Consumers check receipts before processing to ensure idempotency.
//
import { and, eq, isNull, lt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { createOutboxDelivery } from './delivery.server'
import {
  outboxEvents,
  eventConsumerReceipts,
  type OutboxEventInsert,
  type ReceiptStatus,
} from '#/shared/db/schema/outbox.schema'
import { trace } from '#/shared/observability/trace'

// ── Constants ───────────────────────────────────────────────────────

/**
 * Default relay lease duration. The relay imports it for its config default;
 * health-metrics derives the stalled-lease threshold (2× this) from it so the
 * two never drift.
 */
export const DEFAULT_LEASE_DURATION_MS = 30_000

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
  /** Insert a new outbox event. Call within the source context's transaction. */
  insert: (event: OutboxEventInsert) => Promise<void>
  /** Check if a consumer has already processed an event. */
  hasReceipt: (eventId: string, consumerName: string) => Promise<boolean>
  /** Record a consumer receipt. */
  insertReceipt: (
    eventId: string,
    consumerName: string,
    status: ReceiptStatus,
  ) => Promise<void>
  /** Find events with expired leases (health-metrics' expired-lease signal). */
  findExpiredLeases: (limit: number) => Promise<readonly UnpublishedEvent[]>
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
    insert: async (event) => {
      await trace('outbox.insert', async () => {
        await db.insert(outboxEvents).values(event)
      })
    },

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

    findExpiredLeases: async (limit) => {
      return trace('outbox.findExpiredLeases', async () => {
        const rows = await db
          .select({
            id: outboxEvents.id,
            eventType: outboxEvents.eventType,
            eventVersion: outboxEvents.eventVersion,
            payload: outboxEvents.payload,
            organizationId: outboxEvents.organizationId,
            propertyId: outboxEvents.propertyId,
            sourceContext: outboxEvents.sourceContext,
            sourceAggregateId: outboxEvents.sourceAggregateId,
            recordedAt: outboxEvents.createdAt,
          })
          .from(outboxEvents)
          .where(
            and(
              isNull(outboxEvents.publishedAt),
              isNull(outboxEvents.recoveryFencedAt),
              lt(outboxEvents.leaseExpiresAt, new Date()),
            ),
          )
          .limit(limit)

        return rows
      })
    },
  }
}
