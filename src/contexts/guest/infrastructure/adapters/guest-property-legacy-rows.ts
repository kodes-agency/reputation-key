// The compatibility mirrors of one Property's Guest rows. The Property erase
// contributor covers the canonical tables; the Organization purge also deletes
// these three, so a Property erasure run through the rights script must too.
// Every statement is bound to one organization_id AND one property_id, and the
// rows are deleted, never the tables.

import { and, eq, sql } from 'drizzle-orm'
import type { PropertyEraseScope } from '#/contexts/property/application/ports/property-erase-contributor.port'
import { feedback, ratings, scanEvents } from '#/shared/db/schema/guest.schema'
import type { Tx } from '#/shared/outbox/commit'

export const GUEST_LEGACY_PROPERTY_TABLES = Object.freeze([
  'feedback',
  'ratings',
  'scan_events',
] as const)

type LegacyTable = typeof feedback | typeof ratings | typeof scanEvents

/** `feedback` references `ratings`, so it goes first. */
const TABLES: readonly LegacyTable[] = [feedback, ratings, scanEvents]

export type GuestLegacyPropertyCount = Readonly<{ table: string; rowCount: number }>

export async function countGuestLegacyPropertyRows(
  tx: Tx,
  scope: PropertyEraseScope,
): Promise<readonly GuestLegacyPropertyCount[]> {
  const counts: GuestLegacyPropertyCount[] = []
  for (const [index, table] of TABLES.entries()) {
    const result = await tx.execute(sql`
      SELECT COUNT(*)::int AS "rows" FROM ${table}
      WHERE ${table.organizationId} = ${scope.organizationId}
        AND ${table.propertyId} = ${scope.propertyId}
    `)
    counts.push({
      table: GUEST_LEGACY_PROPERTY_TABLES[index]!,
      rowCount: Number((result.rows[0] as { rows?: number } | undefined)?.rows ?? 0),
    })
  }
  return counts
}

/** IRREVERSIBLE. Returns the number of rows removed. */
export async function eraseGuestLegacyPropertyRows(
  tx: Tx,
  scope: PropertyEraseScope,
): Promise<number> {
  let erased = 0
  for (const table of TABLES) {
    const removed = await tx
      .delete(table)
      .where(
        and(
          eq(table.organizationId, scope.organizationId),
          eq(table.propertyId, scope.propertyId),
        ),
      )
      .returning({ id: table.id })
    erased += removed.length
  }
  return erased
}
