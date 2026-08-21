// Dashboard context — Drizzle adapter implementing PortalMetricsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings for portal analytics.
// BQC-5.5: scope predicates, the aggregate skeleton, and the statement
// timeout come from the read facade — methods are scope→skeleton wiring.
// TRAP: `metricReadings.occurredAt` is the INGESTION column (`recorded_at`);
// the guest-action time is `metricReadings.eventAt`. metricPortalWhere bounds
// the window on event time — see the note on metricPeriodWhere in read-facade.

import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import { and, eq, sql, count, avg, isNotNull } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type {
  PortalMetricsPort,
  PortalRatingBucket,
  PortalRatingTrendPoint,
} from '../../application/ports/portal-metrics.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import {
  DASHBOARD_READ_BUDGET_MS,
  metricPortalWhere,
  readMetricAggregates,
  withStatementTimeout,
} from '../read-facade'

const PORTAL_RATING_KEY = 'portal.rating'

/** The star bucket for a portal.rating reading. */
const RATING_STARS = sql<number>`CAST(${metricReadings.value} AS INTEGER)`

/** `value` is a `real` column with NO DB-level 1..5 guard — only the writer's
 *  zod schema (z.number().int().min(1).max(5)) keeps it in range today. Both
 *  rating reads constrain it explicitly so a future writer cannot grow a
 *  0★/7★ distribution bucket or push the trend line outside the chart's
 *  fixed 0-5 domain. Constraining the raw value (not the CAST) also keeps a
 *  hypothetical 5.4 out of the average. */
const RATING_VALUE_IN_RANGE = sql`
  ${metricReadings.value} >= 1 AND ${metricReadings.value} <= 5
`

export const createPortalMetricsAdapter = (db: Database): PortalMetricsPort => ({
  async getPortalKpiSums(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ) {
    return trace('dashboard.portalMetrics.getPortalKpiSums', () =>
      readMetricAggregates(
        db,
        metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
      ),
    )
  },

  async getPortalRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingBucket[]> {
    return trace('dashboard.portalMetrics.getPortalRatingDistribution', async () => {
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx
          .select({
            stars: RATING_STARS,
            count: count(),
          })
          .from(metricReadings)
          .where(
            and(
              metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
              RATING_VALUE_IN_RANGE,
            ),
          )
          .groupBy(RATING_STARS)
          .orderBy(RATING_STARS),
      )

      return rows.map((r) => ({
        stars: Number(r.stars),
        count: Number(r.count),
      }))
    })
  },

  async getPortalRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingTrendPoint[]> {
    return trace('dashboard.portalMetrics.getPortalRatingTrend', async () => {
      const rows = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
        tx
          .select({
            // property_local_date is computed per row from properties.timezone
            // (metric/infrastructure/repositories/property-local-date.ts) off the
            // EVENT time, and is required by the governed-provenance CHECK. Bucket
            // on it rather than DATE(recorded_at): the latter is the ingestion
            // timestamp evaluated in the UTC session timezone, so for a property in
            // e.g. America/Los_Angeles every action from 17:00 local onward landed
            // on the next day.
            date: metricReadings.propertyLocalDate,
            avgRating: sql<number>`ROUND(${avg(metricReadings.value)}::NUMERIC, 1)`,
          })
          .from(metricReadings)
          .where(
            and(
              metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
              isNotNull(metricReadings.propertyLocalDate),
              RATING_VALUE_IN_RANGE,
            ),
          )
          .groupBy(metricReadings.propertyLocalDate)
          .orderBy(metricReadings.propertyLocalDate),
      )

      // property_local_date is nullable in drizzle (pre-governance legacy rows);
      // the isNotNull predicate above already excludes them, so this narrows
      // without an assertion rather than inventing a date.
      return rows.flatMap((r) =>
        r.date === null ? [] : [{ date: r.date, avgRating: Number(r.avgRating ?? 0) }],
      )
    })
  },
})
