// Outbox repository — data access for outbox_events and event_consumer_receipts (PRE17A A3).
//
// The repository is the persistence boundary for the transactional outbox.
// Source contexts insert events atomically with their business write.
// The relay claims unpublished events with SKIP LOCKED and publishes to BullMQ.
// Consumers check receipts before processing to ensure idempotency.
//
// BQC-3.7 lease lifecycle (proved against real PostgreSQL):
//   claim   — SKIP LOCKED batch, lease_owner/leased_at/lease_expires_at set
//   renew   — renewLease extends lease_expires_at for the owner's rows only,
//             so a slow publish batch cannot lose the lease mid-publish
//   reclaim — a row whose lease expired is claimable by any relay again
//   release — markPublished sets published_at and clears the lease fields
//
// NOTE on raw SQL in claimUnpublished: db.execute returns driver rows
// (snake_case keys, timestamps as epoch via explicit EXTRACT), so the CTE
// aliases and the mapper below are the honest contract — SET targets must be
// unqualified column names (PostgreSQL rejects relation-qualified SET).

import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  outboxEvents,
  eventConsumerReceipts,
  type OutboxEventInsert,
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
  /**
   * BQC-3.7: extend the lease on a claimed batch mid-publish. Ownership-
   * guarded — only rows still leased to `leaseOwner` and still unpublished
   * are touched. Returns the number of rows renewed.
   */
  renewLease: (
    eventIds: readonly string[],
    leaseOwner: string,
    leaseDurationMs: number,
  ) => Promise<number>
  /** Mark an event as published (BullMQ accepted the add). Clears the lease. */
  markPublished: (eventId: string) => Promise<void>
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
  // BQC-1.6: outbox retention runs through the scheduled retention-sweep
  // (bounded CTE executor + evidence), replacing the unused invalid
  // DELETE...LIMIT methods that previously lived here.
}>

// Raw driver row shape returned by the claim CTE (snake_case + epoch alias).
type ClaimedRow = Readonly<{
  id: string
  event_type: string
  event_version: number
  payload: unknown
  organization_id: string
  property_id: string | null
  source_context: string
  source_aggregate_id: string
  recordedAtMs: number
}>

function mapClaimedRow(r: ClaimedRow): UnpublishedEvent {
  return {
    id: r.id,
    eventType: r.event_type,
    eventVersion: r.event_version,
    payload: r.payload,
    organizationId: r.organization_id,
    propertyId: r.property_id,
    sourceContext: r.source_context,
    sourceAggregateId: r.source_aggregate_id,
    recordedAt: new Date(r.recordedAtMs),
  }
}

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
          SET lease_owner = ${leaseOwner},
              leased_at = NOW(),
              lease_expires_at = ${leaseExpiresAt}
          FROM claimed
          WHERE ${outboxEvents.id} = claimed.id
          RETURNING ${outboxEvents.id},
                    ${outboxEvents.eventType},
                    ${outboxEvents.eventVersion},
                    ${outboxEvents.payload},
                    ${outboxEvents.organizationId},
                    ${outboxEvents.propertyId},
                    ${outboxEvents.sourceContext},
                    ${outboxEvents.sourceAggregateId},
                    (EXTRACT(EPOCH FROM ${outboxEvents.createdAt}) * 1000)::float8 AS "recordedAtMs"
        `)

        return (rows.rows as unknown as ClaimedRow[]).map(mapClaimedRow)
      })
    },

    renewLease: async (eventIds, leaseOwner, leaseDurationMs) => {
      if (eventIds.length === 0) return 0
      return trace('outbox.renewLease', async () => {
        // Ownership-guarded: a row is only renewed while THIS relay still owns
        // it and it is still unpublished — never steals or resurrects a lease.
        const result = await db
          .update(outboxEvents)
          .set({ leaseExpiresAt: new Date(Date.now() + leaseDurationMs) })
          .where(
            and(
              inArray(outboxEvents.id, [...eventIds]),
              eq(outboxEvents.leaseOwner, leaseOwner),
              isNull(outboxEvents.publishedAt),
            ),
          )
        return result.rowCount ?? 0
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
            recordedAt: outboxEvents.createdAt,
          })
          .from(outboxEvents)
          .where(
            and(
              isNull(outboxEvents.publishedAt),
              lt(outboxEvents.leaseExpiresAt, new Date()),
            ),
          )
          .limit(limit)

        return rows
      })
    },
  }
}
