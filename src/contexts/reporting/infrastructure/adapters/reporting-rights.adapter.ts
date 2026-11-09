// Reporting's executor for the manual rights script: access export and
// Organization purge of goal, metric and dashboard records.
//
// Every statement is bound to one Organization id, every exported column comes
// from an allowlist, and an exported row whose Organization differs from the
// request aborts the export. The purge runs in one transaction behind the
// Organization's lifecycle hold; the monthly-result guard is switched off only
// inside that transaction, and a rollback restores it.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  BackupErasureLedgerContext,
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type {
  RightsExecutor,
  RightsExportFile,
} from '#/shared/ops/rights/rights-executor'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { portalMetricEvidenceSql } from '../../portal-results/portal-analytics-evidence.server'
import {
  foldEvidenceRows,
  portalEvidenceFamilies,
  type EvidenceRow,
} from '../../portal-results/portal-analytics-shared.server'
import {
  MONTHLY_RESULT_GUARD,
  REPORTING_EXPORT_TABLES,
  REPORTING_ORGANIZATION_ONLY_TABLES,
  REPORTING_PURGE_ORDER,
  type ReportingExportTable,
} from './reporting-rights-plan'

const CONTEXT = 'reporting'

export type RightsPurgeOutcome = Readonly<{
  deleted: Readonly<Record<string, number>>
  evidenceRef: string
}>
const LOCK_TIMEOUT = '5s'
/** Supersession chains are short; a cycle fails loudly instead of looping. */
const MAX_CHAIN_PASSES = 64

type Row = Record<string, unknown>

function encodeValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, encodeValue, 2)}\n`)
}

/** The Property a request is limited to; absent for an Organization request. */
type PropertyFilter = string | undefined

/** `AND property_id = …` for a Property request, nothing for an Organization one. */
const propertyClause = (property: PropertyFilter) =>
  property ? sql`AND property_id = ${property}` : sql``

function selectTable(
  spec: ReportingExportTable,
  organization: string,
  property: PropertyFilter,
) {
  const columns = sql.join(
    spec.columns.map((column) => sql`t.${sql.identifier(column)}`),
    sql`, `,
  )
  const order = sql.raw(
    spec.orderBy
      .split(',')
      .map((part) => `t.${part.trim()}`)
      .join(', '),
  )
  if (spec.tenant === 'through_reading') {
    return sql`
      SELECT ${columns}, r.organization_id AS tenant_organization_id
      FROM ${sql.identifier(spec.table)} t
      JOIN metric_readings r ON r.id = t.reading_id
      WHERE r.organization_id = ${organization}
        ${property ? sql`AND r.property_id = ${property}` : sql``}
      ORDER BY ${order}`
  }
  return sql`
    SELECT ${columns}, t.organization_id AS tenant_organization_id
    FROM ${sql.identifier(spec.table)} t
    WHERE t.organization_id = ${organization}
      ${property ? sql`AND t.property_id = ${property}` : sql``}
    ORDER BY ${order}`
}

/** Allowlisted columns only, and only rows that belong to the requested tenant. */
export function projectTenantRows(
  spec: ReportingExportTable,
  rows: readonly Row[],
  organization: string,
): readonly Row[] {
  return rows.map((row) => {
    if (row.tenant_organization_id !== organization) {
      throw new Error(`${spec.table} returned a row outside the requested Organization`)
    }
    return Object.fromEntries(spec.columns.map((column) => [column, row[column] ?? null]))
  })
}

async function readAccess(
  db: Database,
  organization: string,
  property?: string,
): Promise<readonly RightsExportFile[]> {
  const files: RightsExportFile[] = []
  const counts: Record<string, number> = {}
  await db.transaction(
    async (tx) => {
      for (const spec of REPORTING_EXPORT_TABLES) {
        if (property && REPORTING_ORGANIZATION_ONLY_TABLES.includes(spec.table)) continue
        const result = await tx.execute(selectTable(spec, organization, property))
        const records = projectTenantRows(spec, result.rows as Row[], organization)
        counts[spec.table] = records.length
        files.push({
          path: `reporting/${spec.table}.json`,
          bytes: encode({ table: spec.table, columns: spec.columns, records }),
        })
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  files.push({
    path: 'reporting/manifest.json',
    bytes: encode({ context: CONTEXT, organizationId: organization, rowCounts: counts }),
  })
  return files
}

async function assertHeld(tx: Tx, organization: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT state FROM organization_lifecycle_authority
    WHERE organization_id = ${organization}
  `)
  const state = (result.rows[0] as { state?: string } | undefined)?.state
  if (state === undefined) throw new Error('Organization has no lifecycle record')
  if (state === 'active') {
    throw new Error('Organization is still active; suspend it before a purge')
  }
}

function count(value: unknown): number {
  return Number((value as string | number | null | undefined) ?? 0)
}

/** Pause the goals that would otherwise keep opening months. */
async function fencePrograms(
  tx: Tx,
  organization: string,
  at: Date,
  property: PropertyFilter,
): Promise<void> {
  await tx.execute(sql`
    UPDATE goal_programs
    SET status = 'paused',
        status_reason = ${property ? 'property_erasure_fence' : 'organization_closure_fence'},
        updated_at = ${at}
    WHERE organization_id = ${organization} AND status = 'active'
      ${propertyClause(property)}
  `)
}

async function assertNoLiveGoalWork(
  tx: Tx,
  organization: string,
  property: PropertyFilter,
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM goal_programs
        WHERE organization_id = ${organization} AND status = 'active'
          ${propertyClause(property)}) AS active_programs,
      (SELECT count(*) FROM goal_monthly_results
        WHERE organization_id = ${organization} AND status = 'reconciling'
          ${propertyClause(property)}) AS reconciling
  `)
  const row = result.rows[0] as { active_programs?: unknown; reconciling?: unknown }
  if (count(row.active_programs) > 0 || count(row.reconciling) > 0) {
    throw new Error('a goal is still being evaluated; try again after it settles')
  }
}

async function assertPortalFactsSettled(
  tx: Tx,
  organization: string,
  at: Date,
  property: PropertyFilter,
): Promise<void> {
  const scopes = (
    await tx.execute(sql`
      SELECT property_id::text AS property_id, id::text AS portal_id
      FROM portals WHERE organization_id = ${organization}
        ${propertyClause(property)}
    `)
  ).rows as Array<{ property_id: string; portal_id: string }>
  if (scopes.length === 0) return
  const portalIds = scopes.map((scope) => scope.portal_id)
  const evidence = foldEvidenceRows(
    (
      await tx.execute(
        portalMetricEvidenceSql(portalEvidenceFamilies(), {
          organizationId: organizationId(organization),
          portalIds: portalIds.map(portalId),
          propertyIds: [...new Set(scopes.map((scope) => scope.property_id))].map(
            propertyId,
          ),
          startDate: new Date(0),
          endDate: at,
        }),
      )
    ).rows as EvidenceRow[],
    portalIds,
    new Map(),
    at,
  )
  const unsettled = [...evidence.values()].some((families) =>
    Object.values(families).some((family) => family.state !== 'ready'),
  )
  if (unsettled) throw new Error('Portal source facts have not settled')
}

/**
 * Deletes a self-superseding family tip-first: the supersession columns are
 * ON DELETE RESTRICT and PostgreSQL checks them per row.
 */
async function drainChain(tx: Tx, statement: () => ReturnType<typeof sql>) {
  let deleted = 0
  for (let pass = 0; pass < MAX_CHAIN_PASSES; pass += 1) {
    const rows = (await tx.execute(statement())).rowCount ?? 0
    if (rows === 0) return deleted
    deleted += rows
  }
  throw new Error('a supersession chain did not drain')
}

async function deleteTable(
  tx: Tx,
  table: string,
  organization: string,
  property: PropertyFilter,
): Promise<number> {
  if (table === 'goal_result_revisions') {
    return drainChain(
      tx,
      () => sql`
        DELETE FROM goal_result_revisions AS target
        WHERE target.organization_id = ${organization}
          ${property ? sql`AND target.property_id = ${property}` : sql``}
          AND NOT EXISTS (
            SELECT 1 FROM goal_result_revisions AS successor
            WHERE successor.supersedes_revision_id = target.id
          )`,
    )
  }
  if (table === 'metric_corrections') {
    return drainChain(
      tx,
      () => sql`
        DELETE FROM metric_corrections AS correction
        WHERE correction.reading_id IN (
          SELECT id FROM metric_readings WHERE organization_id = ${organization}
            ${propertyClause(property)}
        )
        AND NOT EXISTS (
          SELECT 1 FROM metric_corrections AS successor
          WHERE successor.supersedes_correction_id = correction.id
        )`,
    )
  }
  const result = await tx.execute(
    sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organization}
        ${propertyClause(property)}`,
  )
  return result.rowCount ?? 0
}

/** The Property is the Organization's: its row, or goal and metric rows that name it. */
async function assertPropertyInOrganization(
  tx: Tx,
  organization: string,
  property: string,
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT 1 AS present FROM properties
      WHERE organization_id = ${organization} AND id = ${property}
    UNION ALL
    SELECT 1 FROM goal_programs
      WHERE organization_id = ${organization} AND property_id = ${property}
    UNION ALL
    SELECT 1 FROM metric_readings
      WHERE organization_id = ${organization} AND property_id = ${property}
    LIMIT 1
  `)
  if (result.rows.length === 0) throw new Error('Property not found')
}

/**
 * Every readiness refusal the purge gives, in the order it gives them. An
 * Organization purge waits for the Organization's lifecycle hold; a Property
 * request runs while the Organization is active.
 */
async function assertReadyToPurge(
  tx: Tx,
  organization: string,
  at: Date,
  property: PropertyFilter,
): Promise<void> {
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`))
  if (property) await assertPropertyInOrganization(tx, organization, property)
  else await assertHeld(tx, organization)
  await fencePrograms(tx, organization, at, property)
  await assertNoLiveGoalWork(tx, organization, property)
  await assertPortalFactsSettled(tx, organization, at, property)
}

class PurgeProbeRolledBack extends Error {}

/**
 * The reason a purge would be refused, or null. It runs the same readiness
 * checks as the purge and then rolls back, so nothing is left changed.
 */
async function purgeRefusal(
  db: Database,
  organization: string,
  at: Date,
  property: PropertyFilter,
): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await assertReadyToPurge(tx, organization, at, property)
      throw new PurgeProbeRolledBack()
    })
    return null
  } catch (error) {
    return error instanceof PurgeProbeRolledBack ? null : errorMessage(error)
  }
}

async function purge(
  tx: Tx,
  organization: string,
  at: Date,
  property?: string,
): Promise<RightsPurgeOutcome> {
  await assertReadyToPurge(tx, organization, at, property)

  await tx.execute(
    sql`ALTER TABLE ${sql.identifier(MONTHLY_RESULT_GUARD.table)}
        DISABLE TRIGGER ${sql.identifier(MONTHLY_RESULT_GUARD.trigger)}`,
  )
  // No try/finally: a failed statement aborts the transaction, and the
  // rollback restores the guard.
  const deleted: Record<string, number> = {}
  for (const table of REPORTING_PURGE_ORDER) {
    if (property && REPORTING_ORGANIZATION_ONLY_TABLES.includes(table)) continue
    deleted[table] = await deleteTable(tx, table, organization, property)
  }
  await tx.execute(
    sql`ALTER TABLE ${sql.identifier(MONTHLY_RESULT_GUARD.table)}
        ENABLE TRIGGER ${sql.identifier(MONTHLY_RESULT_GUARD.trigger)}`,
  )
  const rows = Object.values(deleted).reduce((sum, value) => sum + value, 0)
  return { deleted, evidenceRef: `${CONTEXT}:purge:v1:tenant_rows_deleted:${rows}` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

const propertyOf = (plan: RightsRequestPlan): PropertyFilter =>
  plan.scope === 'property' ? plan.propertyId : undefined

/** Why a plan's scope cannot be purged here, or null. */
function purgeScope(plan: RightsRequestPlan): string | null {
  if (plan.scope === 'organization') return null
  if (plan.scope !== 'property') return `no ${CONTEXT} purge for ${plan.scope}`
  return plan.propertyId ? null : '--property is required'
}

export function createReportingRightsExecutor(
  db: Database,
  now: () => Date,
): RightsExecutor {
  return Object.freeze({
    name: CONTEXT,
    scopes: ['access', 'organization', 'property'] as const,
    journalContexts: REPORTING_JOURNAL_CONTEXTS,
    async preflight(plan) {
      if (plan.scope === 'access') return { ok: true }
      const refusal = await purgeScope(plan)
      if (refusal) return { ok: false, error: refusal }
      const purgeError = await purgeRefusal(
        db,
        plan.organizationId,
        now(),
        propertyOf(plan),
      )
      return purgeError ? { ok: false, error: purgeError } : { ok: true }
    },
    async report(plan) {
      const files = await readAccess(db, plan.organizationId, propertyOf(plan))
      const manifest = JSON.parse(
        new TextDecoder().decode(files[files.length - 1]!.bytes),
      ) as { rowCounts: Record<string, number> }
      return Object.entries(manifest.rowCounts).map(([table, rows]) => `${table} ${rows}`)
    },
    exportFiles: (plan) => readAccess(db, plan.organizationId, propertyOf(plan)),
    async apply(plan) {
      const refusal = purgeScope(plan)
      if (refusal) return { ok: false, error: refusal }
      try {
        const outcome = await db.transaction((tx) =>
          purge(tx, plan.organizationId, now(), propertyOf(plan)),
        )
        return {
          ok: true,
          lines: [
            `erasure record org=${plan.organizationId} ${outcome.evidenceRef}`,
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

const REPORTING_JOURNAL_CONTEXTS = [
  'goal',
  'metric',
  'dashboard',
] as const satisfies ReadonlyArray<BackupErasureLedgerContext>

/** Re-purge an Organization's Reporting rows in a restored cell, once per journal context. */
export function createReportingRightsReplayers(
  now: () => Date,
): ReadonlyArray<BackupErasureReplayer> {
  return REPORTING_JOURNAL_CONTEXTS.flatMap((context) =>
    (['organization', 'property'] as const).map((subjectClass) => ({
      context,
      subjectClass,
      async reErase(tx: Tx, entry: BackupErasureLedgerEntry) {
        if (subjectClass === 'property' && !entry.propertyId) {
          throw new Error('journal entry has no Property')
        }
        const outcome = await purge(
          tx,
          entry.organizationId,
          now(),
          subjectClass === 'property' ? entry.propertyId : undefined,
        )
        return Object.values(outcome.deleted).reduce((sum, n) => sum + n, 0)
      },
    })),
  )
}

/** Exported so tests can exercise the purge body against a recording transaction. */
export const reportingPurgeInTransaction = purge
