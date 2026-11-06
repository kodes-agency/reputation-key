import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createWorkItems } from '#/shared/jobs/work-items.server'
import type { Clock } from '#/shared/domain/clock'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  OUTBOX_DELIVERY_KIND,
  OUTBOX_DELIVERY_MAX_ATTEMPTS,
  deliveryRetryDelayMs,
} from '../dispatch-job-options'
import type { DurableConsumerExpectation } from './outbox-repository'

export type DeliveryWork = Readonly<{
  id: string
  organizationId: string
  subjectId: string
  eventType: string
}>

const consumerExpectations = EVENT_FAMILY_ROWS.flatMap(({ eventType, consumers }) =>
  consumers.map(({ name }) => ({ eventType, consumerName: name })),
)

export function createOutboxDelivery(db: Database, clock: Clock) {
  const workItems = createWorkItems(db, clock)
  return {
    workItems,
    readQuarantineMetrics: () => workItems.readQuarantineMetrics(OUTBOX_DELIVERY_KIND),
    retryAt: (attempt: number) =>
      new Date(clock().getTime() + deliveryRetryDelayMs(attempt)),
    async schedulePending(
      limit: number,
      expectations: readonly DurableConsumerExpectation[] = consumerExpectations,
    ): Promise<readonly DeliveryWork[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
        throw new Error('Invalid outbox delivery batch size')
      const expected = expectations.length
        ? sql`VALUES ${sql.join(
            expectations.map(
              ({ eventType, consumerName }) => sql`(${eventType}, ${consumerName})`,
            ),
            sql`, `,
          )}`
        : sql`SELECT NULL::text, NULL::text WHERE false`
      return db.transaction(async (tx) => {
        // No age window or legacy retry budget can strand an unresolved fact.
        // Rank eligible rows by tenant before locking, without a candidate LIMIT:
        // a held tenant cannot hide another tenant outside a locked first page.
        const result = await tx.execute<{
          id: string
          organizationId: string
          eventType: string
        }>(sql`
          WITH expected(event_type, consumer_name) AS (${expected}), ranked AS (
            SELECT o.id, row_number() OVER (
              PARTITION BY o.organization_id ORDER BY o.created_at, o.id
            ) AS turn
            FROM outbox_events o
            WHERE o.recovery_fenced_at IS NULL
              AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= ${clock()})
              AND NOT EXISTS (
                SELECT 1 FROM work_items w WHERE w.organization_id = o.organization_id
                  AND w.kind = ${OUTBOX_DELIVERY_KIND} AND w.idempotency_key = o.id::text
              )
              AND (o.published_at IS NULL OR EXISTS (
                SELECT 1 FROM expected e WHERE e.event_type = o.event_type
                  AND NOT EXISTS (SELECT 1 FROM event_consumer_receipts r
                    WHERE r.event_id = o.id AND r.consumer_name = e.consumer_name)
              ))
          )
          SELECT o.id, o.organization_id AS "organizationId", o.event_type AS "eventType"
          FROM outbox_events o JOIN ranked r ON r.id = o.id
          ORDER BY r.turn, o.created_at, o.id
          FOR UPDATE OF o SKIP LOCKED LIMIT ${limit}
        `)
        const scheduled: DeliveryWork[] = []
        for (const event of result.rows) {
          const work = await workItems.schedule(
            {
              organizationId: event.organizationId,
              subjectId: event.id,
              kind: OUTBOX_DELIVERY_KIND,
              idempotencyKey: event.id,
              dueAt: clock(),
              recovery: 'retry',
              maxAttempts: OUTBOX_DELIVERY_MAX_ATTEMPTS,
            },
            tx,
          )
          await tx
            .update(outboxEvents)
            .set({
              publishedAt: sql`coalesce(${outboxEvents.publishedAt}, ${clock()})`,
              leaseOwner: null,
              leasedAt: null,
              leaseExpiresAt: null,
            })
            .where(eq(outboxEvents.id, event.id))
          scheduled.push({ ...event, id: work.id, subjectId: event.id })
        }
        return scheduled
      })
    },
    async readEvent(organizationId: string, eventId: string) {
      const [event] = await db
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
            eq(outboxEvents.organizationId, organizationId),
            eq(outboxEvents.id, eventId),
            isNull(outboxEvents.recoveryFencedAt),
          ),
        )
        .limit(1)
      return event
    },
  }
}
