// Outbox repository — data access for outbox_events and event_consumer_receipts (PRE17A A3).
//
// The repository is the persistence boundary for the transactional outbox.
// Source contexts insert events atomically with their business write.
// The relay claims unpublished events with SKIP LOCKED and publishes to BullMQ.
// Consumers check receipts before processing to ensure idempotency.

import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  outboxEvents,
  eventConsumerReceipts,
  type OutboxEventInsert,
  type OutboxEventRow,
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
}>

export type ReceiptStatus = 'applied' | 'duplicate' | 'obsolete'

export type OutboxRepository = Readonly<{
  /** Insert a new outbox event. Call within the source context's transaction. */
  insert: (event: OutboxEventInsert) => Promise<void>
  /** Claim a batch of unpublished events for relay. Uses SKIP LOCKED. */
  claimUnpublished: (
    limit: number,
    leaseOwner: string,
    leaseDurationMs: number,
  ) => Promise<readonly UnpublishedEvent[]>
  /** Mark an event as published (BullMQ accepted the add). */
  markPublished: (eventId: string) => Promise<void>
  /** Check if a consumer has already processed an event. */
  hasReceipt: (eventId: string, consumerName: string) => Promise<boolean>
  /** Record a consumer receipt. */
  insertReceipt: (
    eventId: string,
    consumerName: string,
    status: ReceiptStatus,
  ) => Promise<void>
  /** Find events with expired leases for reconciliation. */
  findExpiredLeases: (limit: number) => Promise<readonly UnpublishedEvent[]>
  /** Delete published events older than the cutoff (retention). */
  purgePublishedBefore: (cutoff: Date, limit: number) => Promise<number>
  /** Delete receipts older than the cutoff (retention). */
  purgeReceiptsBefore: (cutoff: Date, limit: number) => Promise<number>
}>

// ── Factory ─────────────────────────────────────────────────────────

export function createOutboxRepository(db: Database): OutboxRepository {
  return {
    insert: async (event) => {
      await trace('outbox.insert', async () => {
        await db.insert(outboxEvents).values(event)
      })
    },

    claimUnpublished: async (limit, leaseOwner, leaseDurationMs) => {
      return trace('outbox.claimUnpublished', async () => {
        // Atomic claim: select unpublished, unleased rows with SKIP LOCKED,
        // set lease_owner and lease_expires_at in the same transaction.
        const leaseExpiresAt = new Date(Date.now() + leaseDurationMs)

        const rows = await db.execute(sql`
          WITH claimed AS (
            SELECT id FROM ${outboxEvents}
            WHERE ${outboxEvents.publishedAt} IS NULL
              AND (${outboxEvents.leaseExpiresAt} IS NULL OR ${outboxEvents.leaseExpiresAt} < NOW())
            ORDER BY ${outboxEvents.createdAt}
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE ${outboxEvents}
          SET ${outboxEvents.leaseOwner} = ${leaseOwner},
              ${outboxEvents.leasedAt} = NOW(),
              ${outboxEvents.leaseExpiresAt} = ${leaseExpiresAt}
          FROM claimed
          WHERE ${outboxEvents.id} = claimed.id
          RETURNING ${outboxEvents.id},
                    ${outboxEvents.eventType},
                    ${outboxEvents.eventVersion},
                    ${outboxEvents.payload},
                    ${outboxEvents.organizationId},
                    ${outboxEvents.propertyId},
                    ${outboxEvents.sourceContext},
                    ${outboxEvents.sourceAggregateId}
        `)

        return (rows.rows as unknown as OutboxEventRow[]).map((r) => ({
          id: r.id,
          eventType: r.eventType,
          eventVersion: r.eventVersion,
          payload: r.payload,
          organizationId: r.organizationId,
          propertyId: r.propertyId,
          sourceContext: r.sourceContext,
          sourceAggregateId: r.sourceAggregateId,
        }))
      })
    },

    markPublished: async (eventId) => {
      await trace('outbox.markPublished', async () => {
        await db
          .update(outboxEvents)
          .set({ publishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
          .where(eq(outboxEvents.id, eventId))
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
          })
          .from(outboxEvents)
          .where(
            and(
              isNull(outboxEvents.publishedAt),
              lt(outboxEvents.leaseExpiresAt, new Date()),
            ),
          )
          .limit(limit)

        return rows as unknown as UnpublishedEvent[]
      })
    },

    purgePublishedBefore: async (cutoff, limit) => {
      return trace('outbox.purgePublished', async () => {
        const result = await db.execute(sql`
          DELETE FROM ${outboxEvents}
          WHERE ${outboxEvents.createdAt} < ${cutoff}
            AND ${outboxEvents.publishedAt} IS NOT NULL
          LIMIT ${limit}
        `)
        return result.rowCount ?? 0
      })
    },

    purgeReceiptsBefore: async (cutoff, limit) => {
      return trace('outbox.purgeReceipts', async () => {
        const result = await db.execute(sql`
          DELETE FROM ${eventConsumerReceipts}
          WHERE ${eventConsumerReceipts.createdAt} < ${cutoff}
          LIMIT ${limit}
        `)
        return result.rowCount ?? 0
      })
    },
  }
}
