// LIF-01-T19 — the Property context's own contribution to a permanent erase.
//
// Property deliberately does NOT delete its `properties` row. `purged` is a
// declared lifecycle state, and the tombstone is what keeps every content-free
// receipt, audit row and ledger entry that names this Property resolvable.
// Deleting the row would cascade parts of that evidence away and would make the
// erase unprovable — the opposite of what an irreversible operation needs.
//
// What Property DOES erase is the name, the slug, the address, the archive note,
// the Google binding and its Responsible Manager rows. The tombstone keeps the
// Property id, its Organization, the erase date and the reason
// `erased on request`; nothing in it names a person.
//
// The Google binding goes in the same statement, so the account and location
// suffixes, the connection reference, the review URI and its pin are gone and
// the location's unique index frees the location: a later reconnect creates a
// fresh Property. The source epoch moves, which fences late sync writes that
// were prepared against the old binding. The Google connection itself and the
// Property's import items belong to the Google executor and are not touched here
// (docs/operations/backup-and-lifecycle.md §9).

import { sql } from 'drizzle-orm'
import type {
  PropertyEraseContributor,
  PropertyEraseInventoryEntry,
  PropertyEraseScope,
} from '#/shared/ops/rights/property-erasure'
import type { Tx } from '#/shared/outbox/commit'

/** The note an erased Property's tombstone carries. */
export const ERASED_ON_REQUEST = 'erased on request'

export const createPropertyPropertyEraseContributor = (): PropertyEraseContributor => ({
  context: 'property',

  inventory: async (
    tx: Tx,
    scope: PropertyEraseScope,
  ): Promise<readonly PropertyEraseInventoryEntry[]> => {
    const result = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM properties
          WHERE id = ${scope.propertyId}::uuid
            AND organization_id = ${scope.organizationId}) AS "properties",
        (SELECT COUNT(*)::int FROM property_responsible_managers
          WHERE property_id = ${scope.propertyId}::uuid
            AND organization_id = ${scope.organizationId}) AS "managers"
    `)
    const row = result.rows[0] as { properties: number; managers: number }
    return [
      { context: 'property', table: 'properties', rowCount: Number(row.properties) },
      {
        context: 'property',
        table: 'property_responsible_managers',
        rowCount: Number(row.managers),
      },
    ]
  },

  erase: async (tx: Tx, scope: PropertyEraseScope): Promise<number> => {
    const managers = await tx.execute(sql`
      DELETE FROM property_responsible_managers
      WHERE property_id = ${scope.propertyId}::uuid
        AND organization_id = ${scope.organizationId}
      RETURNING id
    `)
    // The row survives as a tombstone; its name, slug, address, archive note and
    // Google binding do not (the header lists what stays). The slug is derived
    // from the id rather than nulled because it is NOT NULL and unique, and one
    // shared placeholder would collide across erased Properties.
    const scrubbed = await tx.execute(sql`
      UPDATE properties
      SET name = 'erased-property',
          slug = 'erased-' || id::text,
          address = NULL,
          lifecycle_reason = ${ERASED_ON_REQUEST},
          lifecycle_initiated_by = NULL,
          purge_scheduled_for = NULL,
          google_connection_id = NULL,
          gbp_account_id = NULL,
          gbp_location_id = NULL,
          google_binding_state = 'unbound',
          google_review_uri = NULL,
          google_review_destination_state = 'unavailable',
          google_review_destination_retrieved_at = NULL,
          google_review_destination_source_epoch = NULL,
          google_review_destination_profile_version = NULL,
          google_primary_category = NULL,
          google_primary_category_updated_at = NULL,
          google_primary_category_refresh_event_id = NULL,
          profile_source = 'legacy',
          profile_confirmed_at = NULL,
          profile_confirmed_by = NULL,
          source_epoch = source_epoch + 1,
          updated_at = now()
      WHERE id = ${scope.propertyId}::uuid
        AND organization_id = ${scope.organizationId}
        AND name <> 'erased-property'
      RETURNING id
    `)
    return managers.rows.length + scrubbed.rows.length
  },
})
