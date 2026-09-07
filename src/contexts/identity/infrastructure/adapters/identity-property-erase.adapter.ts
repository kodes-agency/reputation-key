// LIF-01-T19 — Identity's contribution to a permanent Property Erase.
//
// Identity owns two live authority tables scoped to a Property:
// `property_access_grants` (legacy people access) and
// `property_access_grant` (current access). Both are erased.
//
// THE TWO DELIBERATE EXCLUSIONS, and why each would be wrong to erase:
//
//   backup_erasure_ledger  is the evidence that an erasure happened. Destroying
//                          it as part of the erasure it records would remove the
//                          only proof the work was done.
//   privacy_requests       records data-subject access/erasure requests. The
//                          proof that a request was honoured has to outlive the
//                          data it was about.
//
// Both are `recoverable_archive`, and their retention classes are
// counsel-approved work that is still open (`approvalState: pending_counsel`).
// Engineering deciding unilaterally to delete data-subject-request evidence
// during an erasure is exactly the call this program does not let engineering
// make alone.
//
// Property-scoped, not Organization-scoped: every statement is bound to one
// property_id, so erasing a Property leaves its siblings byte-identical.

import { and, eq, sql } from 'drizzle-orm'
import type {
  PropertyEraseContributor,
  PropertyEraseInventoryEntry,
  PropertyEraseScope,
} from '#/contexts/property/application/ports/property-erase-contributor.port'
import { propertyAccessGrants } from '#/shared/db/schema/people-access.schema'
import { propertyAccessGrant } from '#/shared/db/schema/policy.schema'
import type { Tx } from '#/shared/outbox/commit'

/**
 * The Identity tables a Property Erase removes, innermost dependency first.
 *
 * `organizationScoped` records whether the table carries an organization_id to
 * narrow on. Where it does, the predicate uses BOTH columns: a property_id is
 * globally unique, but a tenant-scoped predicate keeps the statement correct
 * even if that ever stops being true.
 */
const IDENTITY_PROPERTY_ERASE_PLAN = Object.freeze([
  {
    table: propertyAccessGrants,
    name: 'property_access_grants',
    organizationScoped: true,
  },
  { table: propertyAccessGrant, name: 'property_access_grant', organizationScoped: true },
] as const)

export const createIdentityPropertyEraseContributor = (): PropertyEraseContributor => ({
  context: 'identity',

  /**
   * READ ONLY, and content-free by construction: a table name and a count.
   * Nothing here can carry the `reason` text or a user identifier, which is
   * what makes the preview safe to show before the AccountAdmin confirms.
   */
  inventory: async (
    tx: Tx,
    scope: PropertyEraseScope,
  ): Promise<readonly PropertyEraseInventoryEntry[]> =>
    await Promise.all(
      IDENTITY_PROPERTY_ERASE_PLAN.map(async (entry) => {
        const result = entry.organizationScoped
          ? await tx.execute(sql`
              SELECT COUNT(*)::int AS "rows" FROM ${entry.table}
              WHERE organization_id = ${scope.organizationId}
                AND property_id = ${scope.propertyId}::uuid
            `)
          : await tx.execute(sql`
              SELECT COUNT(*)::int AS "rows" FROM ${entry.table}
              WHERE property_id = ${scope.propertyId}::uuid
            `)
        return {
          context: 'identity' as const,
          table: entry.name,
          rowCount: Number((result.rows[0] as { rows: number }).rows),
        }
      }),
    ),

  /** IRREVERSIBLE. Ordered so no statement depends on rows already removed. */
  erase: async (tx: Tx, scope: PropertyEraseScope): Promise<number> => {
    let erased = 0
    for (const entry of IDENTITY_PROPERTY_ERASE_PLAN) {
      const where = entry.organizationScoped
        ? and(
            eq(entry.table.organizationId, scope.organizationId),
            eq(entry.table.propertyId, scope.propertyId),
          )
        : eq(entry.table.propertyId, scope.propertyId)
      const removed = await tx
        .delete(entry.table)
        .where(where)
        .returning({ propertyId: entry.table.propertyId })
      erased += removed.length
    }
    return erased
  },
})
