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
import type { Database } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  createOrganizationLifecycleContributorScaffold,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { createPortalLifetimeAggregateRepository } from '../repositories/portal-lifetime-aggregate.repository'

const CONTEXT = 'metric' as const

/**
 * Static, reviewed purge plan. Rows are DELETED; no table is ever dropped and
 * no compatibility mirror is removed. Order matters: `metric_corrections`
 * references `metric_readings` with ON DELETE RESTRICT.
 */
export const METRIC_PURGE_TABLES = Object.freeze([
  'metric_corrections',
  'metric_readings',
  'metric_source_watermarks',
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
        SELECT count(*) FROM metric_source_watermarks
        WHERE organization_id = ${organization}
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

type LifetimeScopeRow = Readonly<{
  property_id: unknown
  portal_id: unknown
}>

async function listLifetimeScopes(
  tx: Tx,
  organization: string,
): Promise<ReadonlyArray<Readonly<{ propertyId: string; portalId: string }>>> {
  const result = await tx.execute(sql`
    SELECT property_id::text AS property_id, portal_id::text AS portal_id
    FROM portal_metric_lifetime_aggregates
    WHERE organization_id = ${organization}
    ORDER BY property_id, portal_id
  `)
  return (result.rows as unknown as LifetimeScopeRow[]).flatMap((row) =>
    typeof row.property_id === 'string' && typeof row.portal_id === 'string'
      ? [{ propertyId: row.property_id, portalId: row.portal_id }]
      : [],
  )
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

/**
 * Purge readiness — READ ONLY, and a real blocker.
 *
 * LIF-01 bullet 11 requires corrections and withdrawals to be applied to the
 * anonymous lifetime aggregate BEFORE the matching source facts are purged.
 * `portalLifetime.inspect` is the existing read-only parity check for exactly
 * that: it recomputes sealed baseline + retained effective facts under the
 * projection lock and reports whether the stored totals match. A row that does
 * not match means a correction/withdrawal has not yet reached the aggregate,
 * so crossing the irreversible boundary would freeze a wrong anonymous total
 * and destroy the source facts needed to rebuild it.
 *
 * A blocker THROWS. The coordinator leaves the lifecycle state at `closing`,
 * no receipt is written (the phase shares this transaction), and the next pass
 * re-verifies. Reporting ready to keep things moving is never an option.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const rows = await countTenantRows(tx, request.organizationId)
  const scopes = await listLifetimeScopes(tx, request.organizationId)
  // The repository already runs its own reads through `tx as Database`; the
  // savepoint it opens keeps the parity check inside this transaction, and
  // `inspect` never writes. The clock is pinned to the supplied `occurredAt`
  // so this phase reads no wall clock of its own.
  const lifetime = createPortalLifetimeAggregateRepository(
    tx as unknown as Database,
    () => request.occurredAt,
  )
  let unreconciled = 0
  for (const scope of scopes) {
    const inspection = await lifetime.inspect({
      organizationId: organizationId(request.organizationId),
      propertyId: propertyId(scope.propertyId),
      portalId: portalId(scope.portalId),
    })
    if (!inspection.matched) unreconciled += 1
  }
  if (unreconciled > 0) {
    throw new Error(
      `metric purge readiness blocked: ${unreconciled} portal lifetime aggregate(s) do not reflect current corrections`,
    )
  }
  return {
    outcome: outcomeFor(rows),
    evidenceRef: evidenceRef('purge_readiness', 'lifetime_parity_verified', rows),
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
  await tx.execute(
    sql`DELETE FROM metric_source_watermarks WHERE organization_id = ${organization}`,
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
