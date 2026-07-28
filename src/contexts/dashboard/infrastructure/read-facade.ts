// Dashboard context — governed read facade (BQC-5.5).
//
// The ONE owner of read policy for dashboard's remaining direct SQL reads
// (metric_readings, inbox_items, goals, and the attention-signals review
// count):
//
// - Scope: tenant + property + date-range predicates live here as builders —
//   adapters compose them instead of open-coding where-clauses.
// - Source eligibility: the attention-signals review count applies THE
//   ADR 0031 predicate (contentExpiresAt non-null and strictly in the future,
//   `now` injected — BQC-5.3). Dashboard keeps its own copy because review's
//   application public-api cannot export SQL fragments (application must not
//   import shared/db); an integration equivalence test pins this predicate
//   and the review-owned rule selecting the same rows over a shared fixture.
// - Timeout: every direct read runs inside withStatementTimeout with
//   DASHBOARD_READ_BUDGET_MS — a slow statement aborts with a tagged
//   DashboardReadTimeout error instead of holding a pool connection.
// - Cache policy: NONE server-side, deliberately. Client TanStack Query
//   staleTimes are the authoritative cache policy; a server cache would be a
//   second read model beside the authoritative query path (BQC-5.5
//   remove-decision: shared/cache/dashboard-cache.ts deleted unwired).

import { and, eq, gte, gt, lte, inArray, isNotNull, sql, sum, count } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricReadings, inboxItems, goals, reviews } from '#/shared/db/schema'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/** Hard statement-level budget for one direct dashboard read. */
export const DASHBOARD_READ_BUDGET_MS = 5000

// ── Scoped where-builders (one per table family) ──────────────────────

/** metric_readings scope: tenant + property + occurredAt range. */
export function metricPeriodWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(metricReadings.organizationId, organizationId),
    eq(metricReadings.propertyId, propertyId),
    gte(metricReadings.occurredAt, startDate),
    lte(metricReadings.occurredAt, endDate),
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

/** metric_readings scope for a set of portals. */
export function metricPortalsWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  portalIds: ReadonlyArray<PortalId>,
  startDate: Date,
  endDate: Date,
) {
  return and(
    metricPeriodWhere(organizationId, propertyId, startDate, endDate),
    // Drizzle inArray() doesn't accept branded PortalId[] — the cast is safe
    // because PortalId is a string-brand.
    inArray(metricReadings.portalId, portalIds as unknown as string[]),
  )
}

/** inbox_items scope: tenant + property. */
export function inboxScopeWhere(organizationId: OrganizationId, propertyId: PropertyId) {
  return and(
    eq(inboxItems.organizationId, organizationId),
    eq(inboxItems.propertyId, propertyId),
  )
}

/** goals scope: tenant + property. */
export function goalScopeWhere(organizationId: OrganizationId, propertyId: PropertyId) {
  return and(eq(goals.organizationId, organizationId), eq(goals.propertyId, propertyId))
}

/**
 * Attention-signals review scope: tenant + property + THE source-eligibility
 * predicate (ADR 0031 — mirrors review's isContentEligibleForRead with `now`
 * injected). Equivalence with the review-owned rule is pinned by
 * repositories/attention-eligibility-equivalence.test.ts.
 */
export function eligibleAttentionReviewWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  now: Date,
) {
  return and(
    eq(reviews.organizationId, organizationId),
    eq(reviews.propertyId, propertyId),
    isNotNull(reviews.contentExpiresAt),
    gt(reviews.contentExpiresAt, now),
  )
}

// ── Shared direct reads (one query skeleton per table family) ───────

export type MetricAggregateRow = Readonly<{
  metricKey: string
  total: number
  count: number
}>

/**
 * THE aggregate skeleton over metric_readings: summed + counted values
 * grouped by metricKey for a scope. Consumers project the fields their port
 * returns (sums, counts, or both). Runs under the statement budget.
 */
export async function readMetricAggregates(
  db: Database,
  scope: SQL | undefined,
): Promise<readonly MetricAggregateRow[]> {
  const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
    tx
      .select({
        metricKey: metricReadings.metricKey,
        total: sum(metricReadings.value),
        count: count(metricReadings.value),
      })
      .from(metricReadings)
      .where(scope)
      .groupBy(metricReadings.metricKey),
  )
  return rows.map((r) => ({
    metricKey: r.metricKey,
    total: Number(r.total ?? 0),
    count: Number(r.count ?? 0),
  }))
}

/** Inbox item count for a scope (open, escalated-unresolved, …). */
export async function readInboxItemCount(
  db: Database,
  scope: SQL | undefined,
): Promise<number> {
  const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
    tx.select({ count: count() }).from(inboxItems).where(scope),
  )
  return Number(rows[0]?.count ?? 0)
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
  read: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${String(budgetMs)}, true)`,
      )
      return await read(tx as unknown as Database)
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
