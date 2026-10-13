// LIF-01-T19 — the Property context's own contribution to a permanent erase.
//
// Property deliberately does NOT delete its `properties` row. `purged` is a
// declared lifecycle state, and the tombstone is what keeps every content-free
// receipt, audit row and ledger entry that names this Property resolvable.
// Deleting the row would cascade parts of that evidence away and would make the
// erase unprovable — the opposite of what an irreversible operation needs.
//
// What Property DOES erase is the name, the slug and the address, and its
// Responsible Manager rows.
//
// What the tombstone STILL KEEPS, and an owner decision has to settle before
// this path is armed (docs/operations/backup-and-lifecycle.md §9):
//
//   - the archive note (`lifecycle_reason`): 3 to 500 characters of free text
//     an AccountAdmin typed, so it can name a person;
//   - the Google binding: the account and location suffixes, the Organization
//     connection reference, the binding state (still `active` if the Property
//     was never disconnected) and the review URI with its pin.
//
// The location suffix has a second effect. Its unique index is per
// Organization and leaves out only rows with `deleted_at` set, which a
// tombstone never has, so the same Google location cannot be imported into
// that Organization again: `createBoundProperty` answers
// `location_already_bound`. `scrubProviderIdentity` on the binding store clears
// exactly these binding columns and has no caller yet.

import { sql } from 'drizzle-orm'
import type {
  PropertyEraseContributor,
  PropertyEraseInventoryEntry,
  PropertyEraseScope,
} from '../../application/ports/property-erase-contributor.port'
import type { Tx } from '#/shared/outbox/commit'

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
    // The row survives as a tombstone; its name, slug and address do not (the
    // header lists what it still keeps). The slug is derived from the id rather
    // than nulled because it is NOT NULL and unique, and one shared placeholder
    // would collide across erased Properties.
    const scrubbed = await tx.execute(sql`
      UPDATE properties
      SET name = 'erased-property',
          slug = 'erased-' || id::text,
          address = NULL,
          updated_at = now()
      WHERE id = ${scope.propertyId}::uuid
        AND organization_id = ${scope.organizationId}
        AND name <> 'erased-property'
      RETURNING id
    `)
    return managers.rows.length + scrubbed.rows.length
  },
})
