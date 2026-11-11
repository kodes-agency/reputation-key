// Portal's executor for the manual rights script: the Portal data an
// Organization may receive, and the erasure of one Property's or one
// Organization's Portal rows.
//
// Both scopes delete the tables of PORTAL_PURGE_PLAN in its order, every
// statement bound to the Organization id (and the Property id for a Property).
// Uploaded images live in the object store, which no transaction can roll back:
// the objects are removed first, outside the database transaction, because the
// rows are the only record of their keys, and removing an object that is
// already gone is not an error. A refusal is probed with a rolled-back run of
// the same deletes before any object is touched.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { assertOrganizationHeld } from '#/shared/db/lifecycle/assert-organization-held'
import type { Tx } from '#/shared/outbox/commit'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type {
  RightsExecutor,
  RightsExportFile,
} from '#/shared/ops/rights/rights-executor'
import type { StoragePort } from '../../application/ports/storage.port'
import { createPortalOrganizationExportContributor } from './portal-organization-export.adapter'
import { PORTAL_PURGE_PLAN } from './portal-organization-erasure'

const CONTEXT = 'portal'
const LOCK_TIMEOUT = '5s'

/** Tables that carry no `property_id`: they hang off a Portal or a group. */
const PORTAL_KEYED_TABLES: ReadonlySet<string> = new Set(['portal_link_categories'])

export type PortalRightsScope = Readonly<{
  organizationId: string
  propertyId?: string
}>

export type PortalErasureOutcome = Readonly<{
  deleted: Readonly<Record<string, number>>
  total: number
}>

function tenantFilter(table: string, scope: PortalRightsScope): SQL {
  const organization = sql`organization_id = ${scope.organizationId}`
  if (!scope.propertyId) return organization
  if (PORTAL_KEYED_TABLES.has(table)) {
    return sql`${organization} AND portal_id IN (
      SELECT id FROM portals
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}
    )`
  }
  return sql`${organization} AND property_id = ${scope.propertyId}`
}

function count(value: unknown): number {
  return Number((value as string | number | null | undefined) ?? 0)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

async function countScope(
  tx: Tx,
  scope: PortalRightsScope,
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of PORTAL_PURGE_PLAN) {
    const result = await tx.execute(
      sql`SELECT count(*) AS rows FROM ${sql.identifier(table)} WHERE ${tenantFilter(table, scope)}`,
    )
    counts[table] = count((result.rows[0] as { rows?: unknown } | undefined)?.rows)
  }
  return counts
}

/** The keys of the scope's images whose objects may still be in the store. */
async function listObjectKeys(
  db: Database,
  scope: PortalRightsScope,
): Promise<readonly string[]> {
  const result = await db.execute(sql`
    SELECT object_key FROM portal_media_assets
    WHERE ${tenantFilter('portal_media_assets', scope)} AND object_deleted_at IS NULL
    ORDER BY object_key
  `)
  return (result.rows as Array<{ object_key: string }>).map((row) => row.object_key)
}

async function assertNothingLive(tx: Tx, organization: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT count(*) AS live FROM portal_publication_activations
    WHERE organization_id = ${organization} AND deactivated_at IS NULL
  `)
  if (count((result.rows[0] as { live?: unknown } | undefined)?.live) > 0) {
    throw new Error('Portal publications are still resolvable')
  }
}

/**
 * The deletes of one scope, innermost first. Exported so a restore replay can
 * run it inside its own transaction; the objects are not touched there.
 */
async function erasePortalScopeInTx(
  tx: Tx,
  scope: PortalRightsScope,
): Promise<PortalErasureOutcome> {
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`))
  const deleted: Record<string, number> = {}
  for (const table of PORTAL_PURGE_PLAN) {
    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)} WHERE ${tenantFilter(table, scope)}`,
    )
    deleted[table] = result.rowCount ?? 0
  }
  const total = Object.values(deleted).reduce((sum, value) => sum + value, 0)
  return { deleted, total }
}

async function assertReady(tx: Tx, scope: PortalRightsScope): Promise<void> {
  if (scope.propertyId) return
  assertOrganizationHeld(scope.organizationId)
  await assertNothingLive(tx, scope.organizationId)
}

class ErasureProbeRolledBack extends Error {}

/**
 * The reason an erasure would be refused, or null. It runs the same checks and
 * deletes as the apply and then rolls back, so a row another context still
 * references is found before any object is removed.
 */
async function erasureRefusal(
  db: Database,
  scope: PortalRightsScope,
): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await assertReady(tx, scope)
      await erasePortalScopeInTx(tx, scope)
      throw new ErasureProbeRolledBack()
    })
    return null
  } catch (error) {
    return error instanceof ErasureProbeRolledBack ? null : errorMessage(error)
  }
}

async function readCounts(
  db: Database,
  scope: PortalRightsScope,
): Promise<Readonly<Record<string, number>>> {
  return db.transaction((tx) => countScope(tx, scope), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  })
}

export type PortalRightsExecutorDeps = Readonly<{
  db: Database
  /** The store that holds uploaded images; an erasure without it would orphan them. */
  objectStore: Pick<StoragePort, 'deleteObject'>
  now: () => Date
}>

export function createPortalRightsExecutor(
  deps: PortalRightsExecutorDeps,
): RightsExecutor {
  const { now } = deps
  const exporter = createPortalOrganizationExportContributor(deps.db)
  const scopeOf = (plan: {
    organizationId: string
    propertyId?: string
    scope: string
  }): PortalRightsScope =>
    plan.scope === 'property' && plan.propertyId
      ? { organizationId: plan.organizationId, propertyId: plan.propertyId }
      : { organizationId: plan.organizationId }

  return Object.freeze({
    name: CONTEXT,
    scopes: ['organization', 'property'] as const,
    tables: { organization: PORTAL_PURGE_PLAN, property: PORTAL_PURGE_PLAN },
    journalContexts: ['portal'] as const,
    async preflight(plan) {
      if (plan.scope === 'property' && !plan.propertyId) {
        return { ok: false, error: '--property is required' }
      }
      const refusal = await erasureRefusal(deps.db, scopeOf(plan))
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    async report(plan) {
      const counts = await readCounts(deps.db, scopeOf(plan))
      return Object.entries(counts).map(([table, rows]) => `${table} ${rows}`)
    },
    async exportFiles(plan): Promise<ReadonlyArray<RightsExportFile>> {
      if (plan.scope !== 'organization') return []
      const contribution = await exporter.contribute({
        organizationId: plan.organizationId,
        requestId: `rights-request:${plan.organizationId}`,
        asOf: now(),
      })
      return contribution.entries.map(({ path, bytes }) => ({ path, bytes }))
    },
    async apply(plan) {
      const scope = scopeOf(plan)
      try {
        const refusal = await erasureRefusal(deps.db, scope)
        if (refusal) return { ok: false, error: refusal }
        for (const objectKey of await listObjectKeys(deps.db, scope)) {
          await deps.objectStore.deleteObject(objectKey)
        }
        const outcome = await deps.db.transaction(async (tx) => {
          await assertReady(tx, scope)
          return erasePortalScopeInTx(tx, scope)
        })
        return {
          ok: true,
          lines: [
            `erasure record org=${plan.organizationId}${
              scope.propertyId ? ` property=${scope.propertyId}` : ''
            } ${CONTEXT}:erase:v1:tenant_rows_deleted:${outcome.total}`,
            ...Object.entries(outcome.deleted).map(
              ([table, rows]) => `  ${table} ${rows}`,
            ),
          ],
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },
  })
}

/** Re-erase an Organization's or Property's Portal rows in a restored cell. */
export function createPortalErasureReplayers(): ReadonlyArray<BackupErasureReplayer> {
  return [
    {
      context: CONTEXT,
      subjectClass: 'organization',
      async reErase(tx, entry) {
        const outcome = await erasePortalScopeInTx(tx, {
          organizationId: entry.organizationId,
        })
        return outcome.total
      },
    },
    {
      context: CONTEXT,
      subjectClass: 'property',
      async reErase(tx, entry) {
        if (!entry.propertyId) throw new Error('journal entry has no Property')
        const outcome = await erasePortalScopeInTx(tx, {
          organizationId: entry.organizationId,
          propertyId: entry.propertyId,
        })
        return outcome.total
      },
    },
  ]
}
