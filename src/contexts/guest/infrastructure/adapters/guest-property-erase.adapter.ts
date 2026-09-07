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
  guestDestinationActionReceipts,
  guestNetworkPressureRecords,
  guestQualifiedScanReceipts,
  guestQualifiedScans,
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import type { Tx } from '#/shared/outbox/commit'

/** Property-scoped Guest tables, innermost dependency first. */
const GUEST_PROPERTY_ERASE_PLAN = Object.freeze([
  'guest_contact_request_reveal_audits',
  'guest_contact_requests',
  'guest_response_private_feedback',
  'guest_response_session_bindings',
  'guest_response_experience_snapshots',
  'guest_response_integrity_decisions',
  'guest_destination_action_receipts',
  'guest_responses',
  'guest_qualified_scan_receipts',
  'guest_qualified_scans',
  'guest_network_pressure_records',
] as const)

const TABLES = [
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestDestinationActionReceipts,
  guestResponses,
  guestQualifiedScanReceipts,
  guestQualifiedScans,
  guestNetworkPressureRecords,
] as const

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
          table: GUEST_PROPERTY_ERASE_PLAN[index] as string,
          rowCount: Number((result.rows[0] as { rows: number }).rows),
        }
      }),
    )
    return counts
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
    return erased
  },
})
