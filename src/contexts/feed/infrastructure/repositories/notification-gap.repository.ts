// Feed notification surface — Drizzle adapter for the notification-gap read.
//
// Reads `inbox_items` from the Feed notification surface, the same way
// inbox-item-lookup.adapter.ts and notification-property-scope.repository.ts
// already do: the projection this context owns is keyed by inbox item, so the
// existence question is answerable here without a cross-context call. Whether
// the item's delivery was decided is read from the durable receipts the
// delivery bridge and its settlement write, as the delivery-lag report does.
//
// An item that arrived as Google history is never a gap: the fan-out never
// announces it (ADR 0046), and both read the same shared predicate.
//
// Two casts are load-bearing: `inbox_items.id` is uuid while
// `notifications.resource_id` is varchar(255) and
// `outbox_events.source_aggregate_id` is text, so both correlations compare
// `id::text` — PostgreSQL has no uuid = varchar operator (the same wrinkle
// inbox-item-lookup.adapter.ts documents). Both compare against literal type
// predicates, so a partial index on either lookup applies.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { notifications } from '#/shared/db/schema/notification.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { NotificationGapRepositoryPort } from '../../application/ports/notification-gap.repository'
import { historicalOnboardingItem } from '../historical-onboarding-item'
import { ON_INBOX_ITEM_CREATED_CONSUMER } from '../notification-outbox-consumers'
import { notificationDeliveryReceiptPrefixes } from '../outbox-notification-delivery'

/** No notification row anywhere points at this inbox item. */
const noNotificationExists = sql`NOT EXISTS (
  SELECT 1
  FROM ${notifications}
  WHERE ${notifications.resourceType} = 'inbox_item'
    AND ${notifications.resourceId} = ${inboxItems.id}::text
)`

/**
 * The Feed consumer took the item's arrival fact, and every delivery it made
 * has settled — a row, preferences that asked for none, or a recipient who no
 * longer qualifies. Nobody is still owed an announcement.
 *
 * Only an `applied` receipt proves the consumer ran: the dispatcher records a
 * terminal gate denial as `obsolete` under the consumer's own name without
 * running it, and an item whose route the gate refuses must keep paging. The
 * consumer's own `obsolete` outcomes never reach this read — a vanished item
 * has no row here, and an unknown source is never a review or feedback.
 */
const deliveryDecided = sql`EXISTS (
  SELECT 1
  FROM ${outboxEvents} AS source
  JOIN ${eventConsumerReceipts} AS base
    ON base.event_id = source.id
   AND base.consumer_name = ${ON_INBOX_ITEM_CREATED_CONSUMER}
   AND base.status = 'applied'
  WHERE source.event_type = 'inbox.inbox_item.created'
    AND source.source_aggregate_id = ${inboxItems.id}::text
    AND NOT EXISTS (
      SELECT 1
      FROM ${eventConsumerReceipts} AS enqueued
      WHERE enqueued.event_id = source.id
        AND enqueued.consumer_name LIKE ${`${notificationDeliveryReceiptPrefixes.enqueue}%`}
        AND split_part(enqueued.consumer_name, ':', 2) = ${ON_INBOX_ITEM_CREATED_CONSUMER}
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
)`

export const createNotificationGapRepository = (
  db: Database,
): NotificationGapRepositoryPort => ({
  countItemsMissingNotifications: async ({
    createdAtOrAfter,
    createdBefore,
    scanLimit,
  }): Promise<number> => {
    // LIMIT caps the rows counted, so the gauge saturates instead of paying
    // for an unbounded aggregate on the health-snapshot path (same shape as
    // EXPIRED_LEASE_SCAN_LIMIT). It does not bound the correlated lookups;
    // their indexes do.
    const result = await db.execute<{ missing: number }>(sql`
      SELECT count(*)::int AS missing
      FROM (
        SELECT 1
        FROM ${inboxItems}
        WHERE ${inboxItems.createdAt} >= ${createdAtOrAfter}::timestamptz
          AND ${inboxItems.createdAt} < ${createdBefore}::timestamptz
          AND ${noNotificationExists}
          AND NOT ${historicalOnboardingItem}
          AND NOT ${deliveryDecided}
        LIMIT ${scanLimit}
      ) AS gap
    `)

    return result.rows[0]?.missing ?? 0
  },
})
