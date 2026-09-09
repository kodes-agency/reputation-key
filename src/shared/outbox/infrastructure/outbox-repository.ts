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

export type PublishedEventRedeliveryCandidate = UnpublishedEvent &
  Readonly<{
    redeliveryAttempt: number
  }>

// ReceiptStatus lives in shared/db/schema/outbox.schema (single declaration,
// BQC-5.8) — re-exported here so the public barrel (#/shared/outbox) keeps
// surfacing it from the repository module.
export type { ReceiptStatus }

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
  /**
   * Atomically reserve a bounded batch of stale published events for another
   * pass through the canonical dispatcher. Only events still missing at least
   * one catalogue consumer receipt are eligible. The durable attempt/next-at
   * fields fence overlapping scheduler ticks and cap permanent failures.
   */
  claimPublishedForConsumerRedelivery: (input: {
    consumerExpectations: readonly DurableConsumerExpectation[]
    cutoff: Date
    now: Date
    limit: number
    maxAttempts: number
    backoffBaseMs: number
  }) => Promise<readonly PublishedEventRedeliveryCandidate[]>
  /** Count stale missing-receipt events whose durable redelivery budget is spent. */
  countExhaustedConsumerRedeliveries: (input: {
    consumerExpectations: readonly DurableConsumerExpectation[]
    cutoff: Date
    maxAttempts: number
  }) => Promise<number>
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
        //
        // The ORDER BY inside the CTE chooses WHICH rows are claimed (oldest
        // first). It does not order the result: `UPDATE ... RETURNING` has no
        // defined row order, so the batch handed to the relay came back
        // arbitrarily and `relay.ts` publishes in exactly that order. Two rows
        // inserted 1s apart were observed returning newest-first, which is how
        // an integration test asserting FIFO started failing. The final SELECT
        // is what makes the delivered order match the claimed order; `id` is
        // the tiebreaker so rows sharing a `created_at` are deterministic too.
        const leaseExpiresAt = new Date(Date.now() + leaseDurationMs)

        const rows = await db.execute(sql`
          WITH claimed AS (
            SELECT id FROM ${outboxEvents}
            WHERE ${outboxEvents.publishedAt} IS NULL
              AND ${outboxEvents.recoveryFencedAt} IS NULL
              AND (${outboxEvents.leaseExpiresAt} IS NULL OR ${outboxEvents.leaseExpiresAt} < NOW())
            ORDER BY ${outboxEvents.createdAt}, ${outboxEvents.id}
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          ),
          leased AS (
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
                      ${outboxEvents.createdAt}
          )
          SELECT id,
                 event_type,
                 event_version,
                 payload,
                 organization_id,
                 property_id,
                 source_context,
                 source_aggregate_id,
                 (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS "recordedAtMs"
          FROM leased
          ORDER BY created_at, id
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
              isNull(outboxEvents.recoveryFencedAt),
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
          .where(and(eq(outboxEvents.id, eventId), isNull(outboxEvents.recoveryFencedAt)))
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
    claimPublishedForConsumerRedelivery: async (input) => {
      if (input.consumerExpectations.length === 0 || input.limit <= 0) return []
      return trace('outbox.claimPublishedForConsumerRedelivery', async () => {
        const expectedValues = sql.join(
          input.consumerExpectations.map(
            ({ eventType, consumerName }) => sql`(${eventType}, ${consumerName})`,
          ),
          sql`, `,
        )
        const rows = await db.execute(sql`
          WITH expected(event_type, consumer_name) AS (
            VALUES ${expectedValues}
          ),
          candidates AS (
            SELECT o.id
            FROM ${outboxEvents} AS o
            WHERE o.published_at IS NOT NULL
              AND o.published_at <= ${input.cutoff}
              AND o.recovery_fenced_at IS NULL
              AND o.consumer_redelivery_attempts < ${input.maxAttempts}
              AND (
                o.consumer_redelivery_next_at IS NULL
                OR o.consumer_redelivery_next_at <= ${input.now}
              )
              AND EXISTS (
                SELECT 1
                FROM expected
                WHERE expected.event_type = o.event_type
                  AND NOT EXISTS (
                    SELECT 1
                    FROM ${eventConsumerReceipts} AS receipt
                    WHERE receipt.event_id = o.id
                      AND receipt.consumer_name = expected.consumer_name
                  )
              )
            ORDER BY o.published_at, o.id
            LIMIT ${input.limit}
            FOR UPDATE SKIP LOCKED
          ),
          claimed AS (
            UPDATE ${outboxEvents} AS o
            SET consumer_redelivery_attempts = o.consumer_redelivery_attempts + 1,
                consumer_redelivery_next_at = ${input.now}::timestamptz
                  + (${input.backoffBaseMs} * power(2, o.consumer_redelivery_attempts))
                    * INTERVAL '1 millisecond'
            FROM candidates
            WHERE o.id = candidates.id
            RETURNING o.id,
                      o.event_type,
                      o.event_version,
                      o.payload,
                      o.organization_id,
                      o.property_id,
                      o.source_context,
                      o.source_aggregate_id,
                      o.created_at,
                      o.published_at,
                      o.consumer_redelivery_attempts
          )
          SELECT id,
                 event_type,
                 event_version,
                 payload,
                 organization_id,
                 property_id,
                 source_context,
                 source_aggregate_id,
                 (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS "recordedAtMs",
                 consumer_redelivery_attempts AS "redeliveryAttempt"
          FROM claimed
          ORDER BY published_at, id
        `)

        return (
          rows.rows as unknown as Array<ClaimedRow & { redeliveryAttempt: number }>
        ).map((row) => ({
          ...mapClaimedRow(row),
          redeliveryAttempt: row.redeliveryAttempt,
        }))
      })
    },

    countExhaustedConsumerRedeliveries: async (input) => {
      if (input.consumerExpectations.length === 0) return 0
      return trace('outbox.countExhaustedConsumerRedeliveries', async () => {
        const expectedValues = sql.join(
          input.consumerExpectations.map(
            ({ eventType, consumerName }) => sql`(${eventType}, ${consumerName})`,
          ),
          sql`, `,
        )
        const result = await db.execute(sql`
          WITH expected(event_type, consumer_name) AS (
            VALUES ${expectedValues}
          )
          SELECT count(*)::int AS count
          FROM ${outboxEvents} AS o
          WHERE o.published_at IS NOT NULL
            AND o.published_at <= ${input.cutoff}
            AND o.recovery_fenced_at IS NULL
            AND o.consumer_redelivery_attempts >= ${input.maxAttempts}
            AND EXISTS (
              SELECT 1
              FROM expected
              WHERE expected.event_type = o.event_type
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${eventConsumerReceipts} AS receipt
                  WHERE receipt.event_id = o.id
                    AND receipt.consumer_name = expected.consumer_name
                )
            )
        `)
        const row = result.rows[0]
        return row && typeof row.count === 'number' ? row.count : 0
      })
    },
  }
}
