// Identity's executors for the manual rights script: Identity's rows for one
// Property or one Organization, and the Staff directory of one Property or one
// Organization.
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
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { createIdentityPropertyEraseContributor } from './identity-property-erase.adapter'
import {
  countIdentityOrganizationRows,
  deleteIdentityOrganizationRows,
  IDENTITY_ORGANIZATION_TABLES,
} from './identity-organization-erasure'
import {
  assertStaffOutboxSettled,
  deleteStaffPropertyRows,
  deleteStaffTenantRows,
  STAFF_LIFECYCLE_TABLES,
  STAFF_PROPERTY_LIFECYCLE_TABLES,
} from './staff-organization-erasure'

const grants = createIdentityPropertyEraseContributor()

const IDENTITY_GRANT_TABLES = Object.freeze([
  'merchant_ai_decision_deferrals',
  'property_access_grant',
])

const READ_ONLY = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

async function identityReport(
  db: Database,
  plan: RightsRequestPlan,
): Promise<ReadonlyArray<string>> {
  const { organizationId, propertyId } = plan
  if (plan.scope === 'organization') {
    const counts = await db.transaction(
      (tx) => countIdentityOrganizationRows(tx, organizationId),
      READ_ONLY,
    )
    return counts.map(({ table, rows }) => `${table} ${rows}`)
  }
  if (!propertyId) return []
  const inventory = await db.transaction(
    (tx) => grants.inventory(tx, { organizationId, propertyId }),
    READ_ONLY,
  )
  return inventory.map((entry) => `${entry.table} ${entry.rowCount}`)
}

async function identityErase(db: Database, plan: RightsRequestPlan): Promise<number> {
  const { organizationId, propertyId } = plan
  if (plan.scope === 'organization') {
    return db.transaction((tx) => {
      if (!isOrganizationSuspended(organizationId)) {
        throw new Error(ORGANIZATION_NOT_SUSPENDED)
      }
      return deleteIdentityOrganizationRows(tx, organizationId)
    })
  }
  if (!propertyId) throw new Error('--property is required')
  return db.transaction((tx) => grants.erase(tx, { organizationId, propertyId }))
}

export function createIdentityRightsExecutor(db: Database): RightsExecutor {
  return Object.freeze({
    name: 'identity',
    scopes: ['property', 'organization'] as const,
    tables: {
      property: IDENTITY_GRANT_TABLES,
      organization: IDENTITY_ORGANIZATION_TABLES,
    },
    journalContexts: ['identity'] as const,
    async preflight(plan) {
      if (plan.scope === 'organization') {
        return isOrganizationSuspended(plan.organizationId)
          ? { ok: true }
          : { ok: false, error: ORGANIZATION_NOT_SUSPENDED }
      }
      return plan.propertyId
        ? { ok: true }
        : { ok: false, error: '--property is required' }
    },
    report: (plan) => identityReport(db, plan),
    exportFiles: async () => [],
    async apply(plan) {
      try {
        const rows = await identityErase(db, plan)
        const subject =
          plan.scope === 'organization'
            ? `org=${plan.organizationId}`
            : `property=${plan.propertyId}`
        return { ok: true, lines: [`erasure record ${subject} rows=${rows}`] }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}

async function staffRowCounts(
  tx: Tx,
  organizationId: string,
  propertyId: string | undefined,
): Promise<ReadonlyArray<string>> {
  const lines: string[] = []
  const tables = propertyId ? STAFF_PROPERTY_LIFECYCLE_TABLES : STAFF_LIFECYCLE_TABLES
  const property = propertyId ? sql` AND property_id = ${propertyId}::uuid` : sql``
  for (const table of tables) {
    const result = await tx.execute(sql`
      SELECT count(*)::int AS count FROM ${sql.identifier(table)}
      WHERE organization_id = ${organizationId}${property}
    `)
    lines.push(`${table} ${(result.rows[0] as { count: number }).count}`)
  }
  return lines
}

/**
 * An Organization must be suspended, and Staff must have nothing unpublished
 * for the Organization or Property being erased.
 */
async function staffPurgeRefusal(
  tx: Tx,
  plan: RightsRequestPlan,
): Promise<string | null> {
  if (plan.scope === 'property' && !plan.propertyId) return '--property is required'
  if (plan.scope === 'organization' && !isOrganizationSuspended(plan.organizationId)) {
    return ORGANIZATION_NOT_SUSPENDED
  }
  try {
    await assertStaffOutboxSettled(
      tx,
      plan.organizationId,
      plan.scope === 'property' ? plan.propertyId : undefined,
    )
    return null
  } catch (error) {
    return errorMessage(error)
  }
}

export function createStaffRightsExecutor(db: Database): RightsExecutor {
  return Object.freeze({
    name: 'staff',
    scopes: ['property', 'organization'] as const,
    tables: {
      property: STAFF_PROPERTY_LIFECYCLE_TABLES,
      organization: STAFF_LIFECYCLE_TABLES,
    },
    journalContexts: ['staff'] as const,
    async preflight(plan) {
      const refusal = await db.transaction((tx) => staffPurgeRefusal(tx, plan), READ_ONLY)
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    report: (plan) =>
      db.transaction(
        (tx) =>
          staffRowCounts(
            tx,
            plan.organizationId,
            plan.scope === 'property' ? plan.propertyId : undefined,
          ),
        READ_ONLY,
      ),
    exportFiles: async () => [],
    async apply(plan) {
      try {
        const rows = await db.transaction(async (tx) => {
          const refusal = await staffPurgeRefusal(tx, plan)
          if (refusal) throw new Error(refusal)
          return plan.scope === 'property' && plan.propertyId
            ? deleteStaffPropertyRows(tx, plan.organizationId, plan.propertyId)
            : deleteStaffTenantRows(tx, plan.organizationId)
        })
        const subject =
          plan.scope === 'property'
            ? `property=${plan.propertyId}`
            : `org=${plan.organizationId}`
        return { ok: true, lines: [`erasure record ${subject} rows=${rows}`] }
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

/** Repeats Identity's Organization erase for an Organization a restore brought back. */
export const identityOrganizationErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: 'identity',
  subjectClass: 'organization',
  reErase: (tx, entry) => deleteIdentityOrganizationRows(tx, entry.organizationId),
})

/** Repeats the Staff directory purge for an Organization a restore brought back. */
export const staffOrganizationErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: 'staff',
  subjectClass: 'organization',
  reErase: (tx, entry) => deleteStaffTenantRows(tx, entry.organizationId),
})

/** Repeats the Staff erase for a Property a restore brought back. */
export const staffPropertyErasureReplayer: BackupErasureReplayer = Object.freeze({
  context: 'staff',
  subjectClass: 'property',
  reErase(tx, entry) {
    if (!entry.propertyId) throw new Error('journal entry has no Property')
    return deleteStaffPropertyRows(tx, entry.organizationId, entry.propertyId)
  },
})
