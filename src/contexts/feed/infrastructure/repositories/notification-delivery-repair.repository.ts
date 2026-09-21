// Feed notification surface — Drizzle adapter for the durable-delivery repair
// read.
//
// The same evidence the delivery-lag report counts as materialization pending
// (repositories/notification-delivery-lag.repository.ts), returned as the
// source facts to replay. Unlike that report it reads the fact's payload: the
// repair hands the fact back to its route's consumer exactly as the relay
// would. Payloads are identifier-only (ADR 0030) and are never logged.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import type {
  NotificationDeliveryRepairRepositoryPort,
  UnsettledNotificationDelivery,
} from '../../application/ports/notification-delivery-repair.repository'
import { notificationDeliveryReceiptPrefixes } from '../outbox-notification-delivery'
import { notificationRouteValues } from './notification-route-values'

type UnsettledRow = Readonly<{
  id: string
  eventType: string
  eventVersion: number
  payload: unknown
  organizationId: string
  propertyId: string | null
  sourceContext: string
  sourceAggregateId: string
  recordedAt: Date | string
  consumerName: string
}>

const toDelivery = (row: UnsettledRow): UnsettledNotificationDelivery => ({
  event: {
    id: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    payload: row.payload,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    recordedAt:
      row.recordedAt instanceof Date ? row.recordedAt : new Date(row.recordedAt),
  },
  consumerName: row.consumerName,
})

export const createNotificationDeliveryRepairRepository = (
  db: Database,
): NotificationDeliveryRepairRepositoryPort => ({
  findUnsettledDeliveries: async ({
    recordedAtOrAfter,
    enqueuedBefore,
    cursor,
    limit,
  }): Promise<readonly UnsettledNotificationDelivery[]> => {
    const afterCursor = cursor
      ? sql`AND (event.created_at, event.id, routes.consumer_name) > (${cursor.recordedAt}::timestamptz, ${cursor.eventId}::uuid, ${cursor.consumerName}::text)`
      : sql``

    const result = await db.execute<UnsettledRow>(sql`
      WITH routes(event_type, consumer_name) AS (VALUES ${notificationRouteValues})
      SELECT
        event.id,
        event.event_type AS "eventType",
        event.event_version AS "eventVersion",
        event.payload,
        event.organization_id AS "organizationId",
        event.property_id AS "propertyId",
        event.source_context AS "sourceContext",
        event.source_aggregate_id AS "sourceAggregateId",
        event.created_at AS "recordedAt",
        routes.consumer_name AS "consumerName"
      FROM ${outboxEvents} AS event
      JOIN routes ON routes.event_type = event.event_type
      WHERE event.created_at >= ${recordedAtOrAfter}::timestamptz
        AND event.recovery_fenced_at IS NULL
        ${afterCursor}
        AND EXISTS (
          SELECT 1
          FROM ${eventConsumerReceipts} AS enqueued
          WHERE enqueued.event_id = event.id
            AND enqueued.consumer_name LIKE ${`${notificationDeliveryReceiptPrefixes.enqueue}%`}
            AND split_part(enqueued.consumer_name, ':', 2) = routes.consumer_name
            AND enqueued.status = 'applied'
            AND enqueued.created_at < ${enqueuedBefore}::timestamptz
            AND NOT EXISTS (
              SELECT 1
              FROM ${eventConsumerReceipts} AS materialized
              WHERE materialized.event_id = enqueued.event_id
                AND materialized.consumer_name = replace(
                  enqueued.consumer_name,
                  ${notificationDeliveryReceiptPrefixes.enqueue},
                  ${notificationDeliveryReceiptPrefixes.materialized}
                )
            )
        )
      ORDER BY event.created_at, event.id, routes.consumer_name
      LIMIT ${limit}
    `)

    return result.rows.map(toDelivery)
  },
})
