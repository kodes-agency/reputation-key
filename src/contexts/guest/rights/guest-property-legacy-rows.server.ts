// The compatibility mirror of one Property's Guest rows. The Property erase
// contributor covers the canonical tables; the Organization purge also deletes
// this one, so a Property erasure run through the rights script must too.
// Every statement is bound to one organization_id AND one property_id, and the
// rows are deleted, never the tables.

import { and, eq, sql } from 'drizzle-orm'
import type { PropertyEraseScope } from '#/shared/ops/rights/property-erasure'
import { scanEvents } from '#/shared/db/schema/guest.schema'
import type { Tx } from '#/shared/outbox/commit'

export type GuestLegacyPropertyCount = Readonly<{ table: string; rowCount: number }>

export async function countGuestLegacyPropertyRows(
  tx: Tx,
  scope: PropertyEraseScope,
): Promise<readonly GuestLegacyPropertyCount[]> {
  const result = await tx.execute(sql`
    SELECT COUNT(*)::int AS "rows" FROM ${scanEvents}
    WHERE ${scanEvents.organizationId} = ${scope.organizationId}
      AND ${scanEvents.propertyId} = ${scope.propertyId}
  `)
  return [
    {
      table: 'scan_events',
      rowCount: Number((result.rows[0] as { rows?: number } | undefined)?.rows ?? 0),
    },
  ]
}

/** IRREVERSIBLE. Returns the number of rows removed. */
export async function eraseGuestLegacyPropertyRows(
  tx: Tx,
  scope: PropertyEraseScope,
): Promise<number> {
  const removed = await tx
    .delete(scanEvents)
    .where(
      and(
        eq(scanEvents.organizationId, scope.organizationId),
        eq(scanEvents.propertyId, scope.propertyId),
      ),
    )
    .returning({ id: scanEvents.id })
  return removed.length
}
