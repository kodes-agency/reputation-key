// Property's executor for the manual rights script: the tombstone erase of one
// Property, or of every Property of a closed Organization, and the replayers
// that repeat it after a restore.
//
// A closure tombstones its Properties rather than deleting them: deleting the
// rows would cascade the retained Merchant AI consent evidence away, and the
// tombstone holds no personal data.
//
// The erase is the Property contributor's own body. This wrapper adds the move
// to `purged` with the erase date, which the contributor leaves to the erase
// job, and runs both in one transaction bound to one Organization and one
// Property. The Google import items are the Google executor's; the binding on
// the Property row goes with the tombstone.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  isOrganizationSuspended,
  ORGANIZATION_NOT_SUSPENDED,
} from '#/shared/db/lifecycle/assert-organization-held'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import { createPropertyPropertyEraseContributor } from './property-property-erase.adapter'

const CONTEXT = 'property'
const contributor = createPropertyPropertyEraseContributor()

async function propertyExists(
  tx: Tx,
  organizationId: string,
  propertyId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT 1 FROM properties
    WHERE id = ${propertyId}::uuid AND organization_id = ${organizationId}
  `)
  return result.rows.length > 0
}

/** Erases the Property inside the caller's transaction; returns the rows changed. */
async function erasePropertyTombstoneInTx(
  tx: Tx,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
  erasedAt: Date,
): Promise<number> {
  const changed = await contributor.erase(tx, scope)
  const purged = await tx.execute(sql`
    UPDATE properties
    SET lifecycle_state = 'purged',
        lifecycle_state_changed_at = ${erasedAt.toISOString()}::timestamptz,
        updated_at = ${erasedAt.toISOString()}::timestamptz
    WHERE id = ${scope.propertyId}::uuid
      AND organization_id = ${scope.organizationId}
      AND lifecycle_state <> 'purged'
    RETURNING id
  `)
  return changed + purged.rows.length
}

async function propertiesOf(tx: Tx, organizationId: string): Promise<string[]> {
  const result = await tx.execute(sql`
    SELECT id::text AS id FROM properties
    WHERE organization_id = ${organizationId}
    ORDER BY id
  `)
  return result.rows.map((row) => String((row as { id: string }).id))
}

/** Tombstones every Property of the Organization; returns the rows changed. */
async function eraseOrganizationPropertiesInTx(
  tx: Tx,
  organizationId: string,
  erasedAt: Date,
): Promise<number> {
  let changed = 0
  for (const propertyId of await propertiesOf(tx, organizationId)) {
    changed += await erasePropertyTombstoneInTx(
      tx,
      { organizationId, propertyId },
      erasedAt,
    )
  }
  return changed
}

async function organizationInventory(
  tx: Tx,
  organizationId: string,
): Promise<ReadonlyArray<string>> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM properties
        WHERE organization_id = ${organizationId}) AS properties,
      (SELECT count(*)::int FROM property_responsible_managers
        WHERE organization_id = ${organizationId}) AS managers
  `)
  const row = result.rows[0] as { properties: number; managers: number }
  return [
    `properties ${Number(row.properties)}`,
    `property_responsible_managers ${Number(row.managers)}`,
  ]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

export function createPropertyRightsExecutor(
  db: Database,
  now: () => Date,
): RightsExecutor {
  return Object.freeze({
    name: CONTEXT,
    scopes: ['property', 'organization'] as const,
    tables: {
      property: ['properties', 'property_responsible_managers'],
      organization: ['properties', 'property_responsible_managers'],
    },
    journalContexts: [CONTEXT] as const,
    async preflight(plan) {
      if (plan.scope === 'organization') {
        return isOrganizationSuspended(plan.organizationId)
          ? { ok: true }
          : { ok: false, error: ORGANIZATION_NOT_SUSPENDED }
      }
      if (!plan.propertyId) return { ok: false, error: '--property is required' }
      const propertyId = plan.propertyId
      const found = await db.transaction((tx) =>
        propertyExists(tx, plan.organizationId, propertyId),
      )
      return found ? { ok: true } : { ok: false, error: 'property not found' }
    },
    async report(plan) {
      if (plan.scope === 'organization') {
        return db.transaction((tx) => organizationInventory(tx, plan.organizationId), {
          isolationLevel: 'repeatable read',
          accessMode: 'read only',
        })
      }
      if (!plan.propertyId) return []
      const propertyId = plan.propertyId
      const inventory = await db.transaction(
        (tx) =>
          contributor.inventory(tx, { organizationId: plan.organizationId, propertyId }),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
      return inventory.map((entry) => `${entry.table} ${entry.rowCount}`)
    },
    exportFiles: async () => [],
    async apply(plan) {
      // The journal records the same instant, so a replay writes the same row.
      const erasedAt = plan.verifiedAt ?? plan.receivedAt ?? now()
      if (plan.scope === 'organization') {
        try {
          const rows = await db.transaction((tx) => {
            if (!isOrganizationSuspended(plan.organizationId)) {
              throw new Error(ORGANIZATION_NOT_SUSPENDED)
            }
            return eraseOrganizationPropertiesInTx(tx, plan.organizationId, erasedAt)
          })
          return {
            ok: true,
            lines: [`erasure record org=${plan.organizationId} rows_changed=${rows}`],
          }
        } catch (error) {
          return { ok: false, error: errorMessage(error) }
        }
      }
      if (!plan.propertyId) return { ok: false, error: '--property is required' }
      const propertyId = plan.propertyId
      try {
        const rows = await db.transaction((tx) =>
          erasePropertyTombstoneInTx(
            tx,
            { organizationId: plan.organizationId, propertyId },
            erasedAt,
          ),
        )
        return {
          ok: true,
          lines: [`erasure record property=${propertyId} rows_changed=${rows}`],
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}

/** Repeats the tombstone erase for a Property a restore brought back. */
export const propertyErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: CONTEXT,
  subjectClass: 'property',
  async reErase(tx, entry) {
    if (!entry.propertyId) throw new Error('journal entry has no Property')
    return erasePropertyTombstoneInTx(
      tx,
      { organizationId: entry.organizationId, propertyId: entry.propertyId },
      entry.effectiveErasureAt,
    )
  },
})

/** Repeats the closure's tombstones for an Organization a restore brought back. */
export const propertyOrganizationErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: CONTEXT,
  subjectClass: 'organization',
  reErase: (tx, entry) =>
    eraseOrganizationPropertiesInTx(tx, entry.organizationId, entry.effectiveErasureAt),
})
