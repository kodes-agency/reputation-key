// Published facts still owed a catalogued consumer receipt, recent enough that
// the two-hour redelivery sweep has not claimed them — the set a Queue Redis
// loss strands (lost-dispatch-recovery.ts). A fact the sweep never claimed has
// no consumer_redelivery_next_at, so the read rides
// outbox_events_consumer_redelivery_due_idx. Keyset-paged on the millisecond
// publication time and id: the cursor round-trips through a JS Date exactly,
// where microseconds would hand the same row back forever.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { trace } from '#/shared/observability/trace'
import type { DurableConsumerExpectation, UnpublishedEvent } from './outbox-repository'

export type PublishedAwaitingReceipt = UnpublishedEvent &
  Readonly<{
    /** published_at to the millisecond — the page cursor. */
    publishedAt: Date
  }>

export type PublishedAwaitingReceiptsCursor = Readonly<{ publishedAt: Date; id: string }>

export type ReadPublishedAwaitingReceipts = (
  input: Readonly<{
    consumerExpectations: readonly DurableConsumerExpectation[]
    publishedAfter: Date
    after: PublishedAwaitingReceiptsCursor | null
    limit: number
  }>,
) => Promise<readonly PublishedAwaitingReceipt[]>

type Row = Readonly<{
  id: string
  event_type: string
  event_version: number
  payload: unknown
  organization_id: string
  property_id: string | null
  source_context: string
  source_aggregate_id: string
  recordedAtMs: number
  publishedAtMs: number
}>

const publishedMs = sql`date_trunc('milliseconds', o.published_at)`

export function createPublishedAwaitingReceiptsReader(
  db: Database,
): ReadPublishedAwaitingReceipts {
  return async (input) => {
    if (input.consumerExpectations.length === 0 || input.limit <= 0) return []
    return trace('outbox.readPublishedAwaitingReceipts', async () => {
      const expectedValues = sql.join(
        input.consumerExpectations.map(
          ({ eventType, consumerName }) => sql`(${eventType}, ${consumerName})`,
        ),
        sql`, `,
      )
      const after = input.after
      const result = await db.execute(sql`
        WITH expected(event_type, consumer_name) AS (VALUES ${expectedValues})
        SELECT o.id, o.event_type, o.event_version, o.payload, o.organization_id,
               o.property_id, o.source_context, o.source_aggregate_id,
               (EXTRACT(EPOCH FROM o.created_at) * 1000)::float8 AS "recordedAtMs",
               (EXTRACT(EPOCH FROM ${publishedMs}) * 1000)::float8 AS "publishedAtMs"
        FROM ${outboxEvents} AS o
        WHERE o.published_at > ${input.publishedAfter}
          AND o.consumer_redelivery_next_at IS NULL
          AND o.recovery_fenced_at IS NULL
          ${
            after === null
              ? sql``
              : sql`AND (${publishedMs}, o.id) > (${after.publishedAt}::timestamptz, ${after.id}::uuid)`
          }
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
        ORDER BY ${publishedMs}, o.id
        LIMIT ${input.limit}
      `)
      return (result.rows as unknown as Row[]).map((row) => ({
        id: row.id,
        eventType: row.event_type,
        eventVersion: row.event_version,
        payload: row.payload,
        organizationId: row.organization_id,
        propertyId: row.property_id,
        sourceContext: row.source_context,
        sourceAggregateId: row.source_aggregate_id,
        recordedAt: new Date(row.recordedAtMs),
        publishedAt: new Date(row.publishedAtMs),
      }))
    })
  }
}
