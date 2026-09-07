// LIF-01-T19 — Guest's contribution to a permanent Property Erase.
//
// Property-scoped, not Organization-scoped: every statement here is bound to
// ONE property_id. Erasing a Property must leave its siblings in the same
// Organization byte-identical, so a missing `property_id` predicate is the
// defect this adapter is shaped to make impossible.
//
// The plan is the property-scoped subset of `GUEST_PURGE_PLAN`, innermost
// dependency first. `guest_network_pressure_records` is included; the global
// retention cursor and Metric's anonymous lifetime aggregate are not — they are
// other owners' rows and are not this Property's guest content.

import { and, eq, sql } from 'drizzle-orm'
import type {
  PropertyEraseContributor,
  PropertyEraseInventoryEntry,
  PropertyEraseScope,
} from '#/contexts/property/application/ports/property-erase-contributor.port'
import {
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestNetworkPressureRecords,
  guestQualifiedScans,
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import type { Tx } from '#/shared/outbox/commit'

/** Property-scoped Guest tables, innermost dependency first. */
const DIRECT_TABLE_NAMES = Object.freeze([
  'guest_contact_request_reveal_audits',
  'guest_contact_requests',
  'guest_response_private_feedback',
  'guest_response_session_bindings',
  'guest_response_experience_snapshots',
  'guest_response_integrity_decisions',
  'guest_responses',
  'guest_qualified_scans',
  'guest_network_pressure_records',
] as const)

const GUEST_PROPERTY_ERASE_PLAN = Object.freeze([
  ...DIRECT_TABLE_NAMES,
  'idempotency_receipts',
] as const)

const TABLES = [
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestResponses,
  guestQualifiedScans,
  guestNetworkPressureRecords,
] as const
function rowCount(row: unknown): number {
  return row && typeof row === 'object' && 'rows' in row ? Number(row.rows) : 0
}

export const createGuestPropertyEraseContributor = (): PropertyEraseContributor => ({
  context: 'guest',

  /**
   * READ ONLY, and content-free by construction: a table name and a count.
   * This is what the AccountAdmin is shown before they type the confirmation.
   */
  inventory: async (
    tx: Tx,
    scope: PropertyEraseScope,
  ): Promise<readonly PropertyEraseInventoryEntry[]> => {
    const counts = await Promise.all(
      TABLES.map(async (table, index) => {
        const result = await tx.execute(sql`
          SELECT COUNT(*)::int AS "rows" FROM ${table}
          WHERE organization_id = ${scope.organizationId}
            AND property_id = ${scope.propertyId}::uuid
        `)
        return {
          context: 'guest' as const,
          table: DIRECT_TABLE_NAMES[index] as string,
          rowCount: rowCount(result.rows[0]),
        }
      }),
    )
    const receiptCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS "rows" FROM ${idempotencyReceipts}
      WHERE ${idempotencyReceipts.scope} IN ('guest_qualified_scan', 'guest_destination_action')
        AND ${idempotencyReceipts.payload}->>'organizationId' = ${scope.organizationId}
        AND ${idempotencyReceipts.payload}->>'propertyId' = ${scope.propertyId as string}
    `)
    return [
      ...counts,
      {
        context: 'guest',
        table: GUEST_PROPERTY_ERASE_PLAN[GUEST_PROPERTY_ERASE_PLAN.length - 1]!,
        rowCount: rowCount(receiptCount.rows[0]),
      },
    ]
  },

  /** IRREVERSIBLE. Ordered so no statement depends on rows already removed. */
  erase: async (tx: Tx, scope: PropertyEraseScope): Promise<number> => {
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
        .returning({ organizationId: table.organizationId })
      erased += removed.length
    }
    const receipts = await tx
      .delete(idempotencyReceipts)
      .where(
        and(
          sql`${idempotencyReceipts.scope} IN ('guest_qualified_scan', 'guest_destination_action')`,
          sql`${idempotencyReceipts.payload}->>'organizationId' = ${scope.organizationId}`,
          sql`${idempotencyReceipts.payload}->>'propertyId' = ${scope.propertyId as string}`,
        ),
      )
      .returning({ key: idempotencyReceipts.key })
    return erased + receipts.length
  },
})
