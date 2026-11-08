// Metric Organization lifecycle contributor (LIF-01-T12/T13/T14).
//
// Cross-context adapter implementation: CONTEXT.md "Dependency rules" lets an
// `infrastructure/adapters/**` file import the foreign `application/ports/**`
// contract it implements, and nothing else from Identity. Authority binding,
// the advisory lock, receipt idempotence and the append-only content-free
// receipt row all come from the shared store — this file only supplies the
// three reviewed phase bodies.
//
// What Metric owns, and why each phase looks the way it does:
//
//   * Metric records governed readings from OTHER contexts' facts. Its writers
//     are event handlers or durable outbox consumers fed by Guest/Portal/Review;
//     Metric owns no provider credential, outbound call, or per-tenant schedule.
//   * `portal_metric_lifetime_aggregates` is the anonymous All Time
//     projection. It is anonymous with respect to GUESTS — no response,
//     session, contact or activity timestamp — which is exactly why LIF-01
//     bullet 11 keeps it across a Guest source-fact purge. It is NOT anonymous
//     with respect to the TENANT: every row is keyed by organization/property/
//     portal and carries that tenant's counts, so an Organization purge must
//     delete it.

import { sql } from 'drizzle-orm'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { portalMetricEvidenceSql } from '../../portal-results/portal-analytics-evidence.server'
import {
  portalEvidenceFamilies,
  foldEvidenceRows,
  type EvidenceRow,
} from '../../portal-results/portal-analytics-shared.server'

const CONTEXT = 'metric' as const

/**
 * Static, reviewed purge plan. Rows are DELETED; no table is ever dropped and
 * no compatibility mirror is removed. Order matters: `metric_corrections`
 * references `metric_readings` with ON DELETE RESTRICT.
 */
export const METRIC_PURGE_TABLES = Object.freeze([
  'metric_corrections',
  'metric_readings',
  'metric_current_google_reputation_snapshots',
  'portal_metric_lifetime_aggregates',
] as const)

/** A correction chain is short; the guard turns a cycle into a loud failure. */
const MAX_CORRECTION_CHAIN_PASSES = 64

function evidenceRef(
  phase: 'closing' | 'purge_readiness' | 'purge',
  reason: string,
  rows: number,
): string {
  return `${CONTEXT}:${phase}:v1:${reason}:${rows}`
}

function outcomeFor(rows: number): OrganizationLifecyclePhaseOutcome['outcome'] {
  return rows > 0 ? 'complete' : 'no_data'
}

function count(value: unknown): number {
  return Number((value as string | number | null | undefined) ?? 0)
}

/**
 * Total tenant-scoped Metric rows. `metric_corrections` has no organization
 * column of its own — it is tenant-scoped through the reading it corrects.
 */
async function countTenantRows(tx: Tx, organization: string): Promise<number> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*) FROM metric_readings WHERE organization_id = ${organization})
      + (
        SELECT count(*)
        FROM metric_corrections AS correction
        JOIN metric_readings AS reading ON reading.id = correction.reading_id
        WHERE reading.organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM metric_current_google_reputation_snapshots
        WHERE organization_id = ${organization}
      )
      + (
        SELECT count(*) FROM portal_metric_lifetime_aggregates
        WHERE organization_id = ${organization}
      ) AS rows
  `)
  return count((result.rows[0] as { rows?: unknown } | undefined)?.rows)
}

async function listPortalScopes(tx: Tx, organization: string) {
  const result = await tx.execute(sql`
    SELECT property_id::text AS property_id, id::text AS portal_id
    FROM portals WHERE organization_id = ${organization}
  `)
  return result.rows as Array<{ property_id: string; portal_id: string }>
}

/**
 * Closing — STOP EFFECTS, KEEP DATA.
 *
 * Metric has no effect of its own to cancel. It holds no provider credential
 * or subscription, publishes nothing outward, exposes no mutating tenant
 * surface (the context has no `server/` layer by design), and owns no
 * per-tenant schedule. Every Metric writer is a handler or durable consumer
 * of a fact produced by a context that is fenced by its OWN Closing
 * contribution in this same phase, so the correct Metric behaviour during the
 * recoverable window is to let already-committed facts finish landing rather
 * than to invent a fence that closure cancellation would then have to undo.
 *
 * This phase therefore deletes nothing, scrubs nothing and changes no column:
 * it records the affirmative, content-free fact that Metric holds no unfenced
 * effect for this Organization. Bullet 11's correction/withdrawal ordering is
 * verified in the next phase, where a blocked answer can still stop the run.
 */
const prepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const rows = await countTenantRows(tx, request.organizationId)
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('closing', 'no_context_owned_effect', rows),
  }
}

/** Pending corrections must settle before their source facts can be purged. */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const rows = await countTenantRows(tx, request.organizationId)
  const scopes = await listPortalScopes(tx, request.organizationId)
  if (scopes.length > 0) {
    const portalIds = scopes.map((scope) => scope.portal_id)
    const result = await tx.execute(
      portalMetricEvidenceSql(portalEvidenceFamilies(), {
        organizationId: organizationId(request.organizationId),
        portalIds: portalIds.map(portalId),
        propertyIds: [...new Set(scopes.map((scope) => scope.property_id))].map(
          propertyId,
        ),
        startDate: new Date(0),
        endDate: request.occurredAt,
      }),
    )
    const evidence = foldEvidenceRows(
      result.rows as EvidenceRow[],
      portalIds,
      new Map(),
      request.occurredAt,
    )
    if (
      [...evidence.values()].some((families) =>
        Object.values(families).some((family) => family.state !== 'ready'),
      )
    ) {
      throw new Error(
        'metric purge readiness blocked: Portal source facts have not settled',
      )
    }
  }
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('purge_readiness', 'source_facts_verified', rows),
  }
}

/**
 * Deletes the org's corrections tip-first.
 *
 * `metric_corrections.supersedes_correction_id` is ON DELETE RESTRICT, which
 * PostgreSQL checks per row rather than at end of statement, so one flat
 * DELETE over a supersession chain fails. Repeatedly removing the rows nothing
 * else supersedes drains the chain deterministically.
 */
async function purgeCorrections(tx: Tx, organization: string): Promise<number> {
  let deleted = 0
  for (let pass = 0; pass < MAX_CORRECTION_CHAIN_PASSES; pass += 1) {
    const result = await tx.execute(sql`
      DELETE FROM metric_corrections AS correction
      WHERE correction.reading_id IN (
        SELECT id FROM metric_readings WHERE organization_id = ${organization}
      )
      AND NOT EXISTS (
        SELECT 1 FROM metric_corrections AS successor
        WHERE successor.supersedes_correction_id = correction.id
      )
    `)
    const rows = result.rowCount ?? 0
    if (rows === 0) return deleted
    deleted += rows
  }
  throw new Error('metric purge could not drain the correction supersession chain')
}

/**
 * Purge — IRREVERSIBLE, idempotent, content-free.
 *
 * Every statement is bound to one organization id. Nothing is dropped and no
 * compatibility mirror is removed.
 *
 * Goal Program versions pin code-reviewed metric definition IDs, while their
 * monthly results consume readings only through Metric's public read contract.
 * The surviving Goal tables therefore do not pin `metric_readings` during
 * tenant purge.
 */
const purge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const organization = request.organizationId
  const rows = await countTenantRows(tx, organization)
  if (rows === 0) {
    return {
      outcome: 'no_data',
      evidenceRef: evidenceRef('purge', 'nothing_to_scrub', 0),
    }
  }

  await purgeCorrections(tx, organization)
  await tx.execute(
    sql`DELETE FROM metric_readings WHERE organization_id = ${organization}`,
  )
  await tx.execute(sql`
    DELETE FROM metric_current_google_reputation_snapshots
    WHERE organization_id = ${organization}
  `)
  // Anonymous only with respect to Guests. The row is tenant-identified and
  // carries this tenant's lifetime counts, so it goes with the tenant.
  await tx.execute(sql`
    DELETE FROM portal_metric_lifetime_aggregates
    WHERE organization_id = ${organization}
  `)

  return {
    outcome: 'complete',
    evidenceRef: evidenceRef('purge', 'tenant_rows_deleted', rows),
  }
}

/**
 * The scaffold returns a structurally complete `OrganizationLifecycleContributor`.
 * Deliberately NOT part of `MetricContextApi.publicApi`: only Identity's
 * lifecycle coordinator consumes it, and wiring it must not add a key to any
 * tenant-reachable surface.
 */
export const createMetricOrganizationLifecycleAdapter = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: CONTEXT,
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })

/** Exported for the unit test so each phase body can be exercised alone. */
export const METRIC_ORGANIZATION_LIFECYCLE_PHASES = Object.freeze({
  prepareClosing,
  verifyPurgeReadiness,
  purge,
})
