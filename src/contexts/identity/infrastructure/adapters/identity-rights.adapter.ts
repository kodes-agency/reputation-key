// Identity's executors for the manual rights script: the Property access grants
// of one Property, and the Staff directory of one Organization.
//
// Both wrap the lifecycle bodies that already exist, bound to the same
// Organization and Property ids as the original, and add the replayers that
// repeat each erase after a restore. The Staff purge leaves every login
// identity row alone: a person may belong to another Organization.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  isOrganizationSuspended,
  ORGANIZATION_NOT_SUSPENDED,
} from '#/shared/db/lifecycle/assert-organization-held'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import { createIdentityPropertyEraseContributor } from './identity-property-erase.adapter'
import {
  assertStaffOutboxSettled,
  deleteStaffTenantRows,
  STAFF_LIFECYCLE_TABLES,
} from './staff-organization-erasure'

const grants = createIdentityPropertyEraseContributor()

const IDENTITY_GRANT_TABLES = Object.freeze([
  'merchant_ai_decision_deferrals',
  'property_access_grants',
  'property_access_grant',
])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

export function createIdentityPropertyRightsExecutor(db: Database): RightsExecutor {
  return Object.freeze({
    name: 'identity-grants',
    scopes: ['property'] as const,
    tables: { property: IDENTITY_GRANT_TABLES },
    journalContexts: ['identity'] as const,
    async preflight(plan) {
      return plan.propertyId
        ? { ok: true }
        : { ok: false, error: '--property is required' }
    },
    async report(plan) {
      if (!plan.propertyId) return []
      const propertyId = plan.propertyId
      const inventory = await db.transaction(
        (tx) => grants.inventory(tx, { organizationId: plan.organizationId, propertyId }),
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
          grants.erase(tx, { organizationId: plan.organizationId, propertyId }),
        )
        return { ok: true, lines: [`erasure record property=${propertyId} rows=${rows}`] }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}

async function staffRowCounts(
  tx: Tx,
  organizationId: string,
): Promise<ReadonlyArray<string>> {
  const lines: string[] = []
  for (const table of STAFF_LIFECYCLE_TABLES) {
    const result = await tx.execute(sql`
      SELECT count(*)::int AS count FROM ${sql.identifier(table)}
      WHERE organization_id = ${organizationId}
    `)
    lines.push(`${table} ${(result.rows[0] as { count: number }).count}`)
  }
  return lines
}

/** The Organization must be suspended, and Staff must have nothing unpublished. */
async function staffPurgeRefusal(tx: Tx, organizationId: string): Promise<string | null> {
  if (!isOrganizationSuspended(organizationId)) return ORGANIZATION_NOT_SUSPENDED
  try {
    await assertStaffOutboxSettled(tx, organizationId)
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

export function createStaffOrganizationRightsExecutor(db: Database): RightsExecutor {
  return Object.freeze({
    name: 'staff',
    scopes: ['organization'] as const,
    tables: { organization: STAFF_LIFECYCLE_TABLES },
    journalContexts: ['staff'] as const,
    async preflight(plan) {
      const refusal = await db.transaction(
        (tx) => staffPurgeRefusal(tx, plan.organizationId),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    report: (plan) =>
      db.transaction((tx) => staffRowCounts(tx, plan.organizationId), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      }),
    exportFiles: async () => [],
    async apply(plan) {
      try {
        const rows = await db.transaction(async (tx) => {
          const refusal = await staffPurgeRefusal(tx, plan.organizationId)
          if (refusal) throw new Error(refusal)
          return deleteStaffTenantRows(tx, plan.organizationId)
        })
        return {
          ok: true,
          lines: [`erasure record org=${plan.organizationId} rows=${rows}`],
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}

/** Repeats the grant erase for a Property a restore brought back. */
export const identityPropertyErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: 'identity',
  subjectClass: 'property',
  async reErase(tx, entry) {
    if (!entry.propertyId) throw new Error('journal entry has no Property')
    return grants.erase(tx, {
      organizationId: entry.organizationId,
      propertyId: entry.propertyId,
    })
  },
})

/** Repeats the Staff directory purge for an Organization a restore brought back. */
export const staffOrganizationErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: 'staff',
  subjectClass: 'organization',
  reErase: (tx, entry) => deleteStaffTenantRows(tx, entry.organizationId),
})
