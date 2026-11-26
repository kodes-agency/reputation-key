// Share tenant/Property/date predicates and the statement timeout across dashboard reads.
// Every direct read uses DASHBOARD_READ_BUDGET_MS inside withStatementTimeout,
// raising DashboardReadTimeout instead of holding the pool connection indefinitely.
// Client TanStack Query stale times own caching; a server cache would duplicate
// the authoritative read model.

import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { metricReadings, inboxItems } from '#/shared/db/schema'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/** Hard statement-level budget for one direct dashboard read. */
export const DASHBOARD_READ_BUDGET_MS = 5000

// ── Scoped where-builders (one per table family) ──────────────────────

/**
 * metric_readings scope: tenant + property + EVENT-time range.
 *
 * TRAP: the drizzle field `metricReadings.occurredAt` maps to the DB column
 * `recorded_at` (see metric.schema.ts) — it is the INGESTION timestamp, not
 * the guest-action time; metric-command-store.ts performs the swap on write
 * (`eventAt: reading.occurredAt, occurredAt: reading.recordedAt`). The true
 * event time is `metricReadings.eventAt` (column `event_at`), which is what
 * an analytics window must bound: filtering on ingestion means outbox lag,
 * retries or a replay silently shift a day's numbers. The drizzle field is
 * NOT renamed here because it is shared with metric
 * repositories; every reader in this facade must know the swap.
 *
 * Governed readings always carry event_at (metric_readings_governed_provenance_check),
 * and readings/metric-repository.server.ts / recognition.repository.ts / the fleet
 * projection already bound their windows on event_at — this is the same convention.
 */
export function metricPeriodWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(metricReadings.organizationId, organizationId),
    eq(metricReadings.propertyId, propertyId),
    gte(metricReadings.eventAt, startDate),
    lt(metricReadings.eventAt, endDate),
  )
}

/** metric_readings scope for one portal. */
export function metricPortalWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  portalId: PortalId,
  startDate: Date,
  endDate: Date,
) {
  return and(
    metricPeriodWhere(organizationId, propertyId, startDate, endDate),
    eq(metricReadings.portalId, portalId),
  )
}

/** inbox_items scope: tenant + property. */
export function inboxScopeWhere(organizationId: OrganizationId, propertyId: PropertyId) {
  return and(
    eq(inboxItems.organizationId, organizationId),
    eq(inboxItems.propertyId, propertyId),
  )
}

// ── Statement timeout ─────────────────────────────────────────────────

/**
 * Tagged timeout error — an over-budget read aborts with this, never an
 * untagged PG 57014. Infrastructure failures (not domain rejections), so it
 * is NOT a DashboardError code: server fns route it to the generic 500 path.
 */
export type DashboardReadTimeout = Readonly<{
  _tag: 'DashboardReadTimeout'
  budgetMs: number
  message: string
}>

export const isDashboardReadTimeout = (e: unknown): e is DashboardReadTimeout =>
  typeof e === 'object' &&
  e !== null &&
  (e as DashboardReadTimeout)._tag === 'DashboardReadTimeout'

/** PG raises 57014 (query_canceled) when statement_timeout fires. Drizzle
 *  wraps query failures in DrizzleQueryError with the PG error on .cause. */
function isPgStatementTimeout(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; depth < 3 && typeof cur === 'object' && cur !== null; depth++) {
    if ((cur as { code?: unknown }).code === '57014') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

/**
 * Run `read` inside a transaction whose statement_timeout is `budgetMs`
 * (set_config …, true = LOCAL to the transaction — the setting never leaks
 * to the pooled connection). A statement exceeding the budget aborts; the PG
 * 57014 is rethrown as a tagged DashboardReadTimeout.
 */
export async function withStatementTimeout<T>(
  db: Database,
  budgetMs: number,
  read: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${String(budgetMs)}, true)`,
      )
      return await read(tx)
    })
  } catch (err) {
    if (isPgStatementTimeout(err)) {
      throw {
        _tag: 'DashboardReadTimeout',
        budgetMs,
        message: `dashboard read exceeded ${budgetMs}ms budget`,
      } satisfies DashboardReadTimeout
    }
    throw err
  }
}
