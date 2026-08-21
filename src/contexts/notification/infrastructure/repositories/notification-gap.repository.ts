// Notification context — Drizzle adapter for the notification-gap read.
//
// Reads `inbox_items` from the notification context, the same way
// inbox-item-lookup.adapter.ts and notification-property-scope.repository.ts
// already do: the projection this context owns is keyed by inbox item, so the
// existence question is answerable here without a cross-context call.
//
// Two casts are load-bearing:
//   - `inbox_items.id` is uuid and `notifications.resource_id` is varchar(255),
//     so the anti-join needs `id::text` — PostgreSQL has no uuid = varchar
//     operator (the same wrinkle inbox-item-lookup.adapter.ts documents).
//   - the keyset comparison is row-wise `(created_at, id) > (?, ?)`, so both
//     bound parameters are cast to their column types or PostgreSQL cannot
//     pick the `inbox_items_created_at_idx` (created_at, id) index.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { notifications } from '#/shared/db/schema/notification.schema'
import type {
  MissingNotificationCandidate,
  NotificationGapRepositoryPort,
} from '../../application/ports/notification-gap.repository'

/** No notification row anywhere points at this inbox item. */
const noNotificationExists = sql`NOT EXISTS (
  SELECT 1
  FROM ${notifications}
  WHERE ${notifications.resourceType} = 'inbox_item'
    AND ${notifications.resourceId} = ${inboxItems.id}::text
)`

export const createNotificationGapRepository = (
  db: Database,
): NotificationGapRepositoryPort => ({
  findItemsMissingNotifications: async ({
    createdAtOrAfter,
    createdBefore,
    cursor,
    limit,
  }): Promise<readonly MissingNotificationCandidate[]> => {
    const afterCursor = cursor
      ? sql`AND (${inboxItems.createdAt}, ${inboxItems.id}) > (${cursor.createdAt}::timestamptz, ${cursor.inboxItemId}::uuid)`
      : sql``

    const rows = await db
      .select({
        inboxItemId: inboxItems.id,
        organizationId: inboxItems.organizationId,
        propertyId: inboxItems.propertyId,
        sourceType: inboxItems.sourceType,
        createdAt: inboxItems.createdAt,
      })
      .from(inboxItems)
      .where(
        sql`${inboxItems.createdAt} >= ${createdAtOrAfter}::timestamptz
          AND ${inboxItems.createdAt} < ${createdBefore}::timestamptz
          ${afterCursor}
          AND ${noNotificationExists}`,
      )
      .orderBy(inboxItems.createdAt, inboxItems.id)
      .limit(limit)

    return rows
  },

  countItemsMissingNotifications: async ({
    createdAtOrAfter,
    createdBefore,
    scanLimit,
  }): Promise<number> => {
    // Bounded by construction: the inner scan stops at scanLimit rows, so the
    // gauge saturates instead of paying for an unbounded aggregate on the
    // health-snapshot path (same shape as EXPIRED_LEASE_SCAN_LIMIT).
    const result = await db.execute<{ missing: number }>(sql`
      SELECT count(*)::int AS missing
      FROM (
        SELECT 1
        FROM ${inboxItems}
        WHERE ${inboxItems.createdAt} >= ${createdAtOrAfter}::timestamptz
          AND ${inboxItems.createdAt} < ${createdBefore}::timestamptz
          AND ${noNotificationExists}
        LIMIT ${scanLimit}
      ) AS gap
    `)

    return result.rows[0]?.missing ?? 0
  },
})
