// Feed notification surface — the grouped reopens still waiting on a
// Property, read back with the fact that raised each one.
//
// Two reads, not a join: `notifications.event_id` is varchar and
// `outbox_events.id` is uuid, so a join would compare `id::text` and walk the
// Organization's outbox instead of its primary key. The waiting rows of one
// Property are few; their facts are then fetched by id.

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { notificationId, unbrand } from '#/shared/domain/ids'
import type { GroupedReopenStorePort } from '../../application/ports/grouped-reopen-store.port'
import { awaitingSettlement } from './notification.repository'

const GROUPED_REOPEN_TYPE = 'inbox.bulk_reopened'
const BULK_REOPEN_FACT = 'inbox.inbox_items.bulk_reopen_completed'

/**
 * Bounds one settlement's read. A Property with more grouped reopens still
 * waiting than this settles the rest on a later closed cycle.
 */
const WAITING_SCAN_LIMIT = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createGroupedReopenStore = (db: Database): GroupedReopenStorePort => ({
  findWaiting: async ({ organizationId, propertyId }) => {
    const rows = await db
      .select({
        id: notifications.id,
        coalescedCount: notifications.coalescedCount,
        eventId: notifications.eventId,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, unbrand(organizationId)),
          eq(notifications.propertyId, unbrand(propertyId)),
          eq(notifications.type, GROUPED_REOPEN_TYPE),
          awaitingSettlement,
        ),
      )
      .limit(WAITING_SCAN_LIMIT)
    const eventIds = [...new Set(rows.map((row) => row.eventId))].filter((id) =>
      UUID.test(id),
    )
    if (eventIds.length === 0) return []

    // Outbox retention removes a fact 30 days after publication; a notice
    // whose fact is gone cannot be judged and is left as it stands.
    const facts = await db
      .select({ id: outboxEvents.id, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          inArray(outboxEvents.id, eventIds),
          eq(outboxEvents.organizationId, unbrand(organizationId)),
          eq(outboxEvents.eventType, BULK_REOPEN_FACT),
        ),
      )
    const sources = new Map(facts.map((fact) => [fact.id, fact.payload]))
    return rows.flatMap((row) =>
      sources.has(row.eventId)
        ? [
            {
              id: notificationId(row.id),
              coalescedCount: row.coalescedCount,
              source: sources.get(row.eventId),
            },
          ]
        : [],
    )
  },

  settle: async ({ organizationId, ids, resolvedAt }) => {
    if (ids.length === 0) return []
    const settled = await db
      .update(notifications)
      .set({ resolvedAt, updatedAt: resolvedAt })
      .where(
        and(
          eq(notifications.organizationId, unbrand(organizationId)),
          inArray(notifications.id, ids.map(unbrand)),
          eq(notifications.type, GROUPED_REOPEN_TYPE),
          awaitingSettlement,
        ),
      )
      .returning({ id: notifications.id })
    return settled.map((row) => notificationId(row.id))
  },
})
