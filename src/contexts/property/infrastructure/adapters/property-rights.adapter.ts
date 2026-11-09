// Property's executor for the manual rights script: the Property scope's
// tombstone erase, and the replayer that repeats it after a restore.
//
// The erase is the Property contributor's own body. This wrapper adds the move
// to `purged` with the erase date, which the contributor leaves to the erase
// job, and runs both in one transaction bound to one Organization and one
// Property. The Google import items are the Google executor's; the binding on
// the Property row goes with the tombstone.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
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
export async function erasePropertyTombstoneInTx(
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

export function createPropertyRightsExecutor(
  db: Database,
  now: () => Date,
): RightsExecutor {
  return Object.freeze({
    name: CONTEXT,
    scopes: ['property'] as const,
    journalContexts: [CONTEXT] as const,
    async preflight(plan) {
      if (!plan.propertyId) return { ok: false, error: '--property is required' }
      const propertyId = plan.propertyId
      const found = await db.transaction((tx) =>
        propertyExists(tx, plan.organizationId, propertyId),
      )
      return found ? { ok: true } : { ok: false, error: 'property not found' }
    },
    async report(plan) {
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
      if (!plan.propertyId) return { ok: false, error: '--property is required' }
      const propertyId = plan.propertyId
      try {
        const rows = await db.transaction((tx) =>
          erasePropertyTombstoneInTx(
            tx,
            { organizationId: plan.organizationId, propertyId },
            // The journal records the same instant, so a replay writes the same row.
            plan.verifiedAt ?? plan.receivedAt ?? now(),
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
