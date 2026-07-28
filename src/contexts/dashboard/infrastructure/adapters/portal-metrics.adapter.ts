// Dashboard context — Drizzle adapter implementing PortalMetricsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings for portal analytics.
// BQC-5.5: scope predicates, the aggregate skeleton, and the statement
// timeout come from the read facade — methods are scope→skeleton wiring.

import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import { and, eq, sql, count, avg } from 'drizzle-orm'
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
            stars: sql<number>`CAST(${metricReadings.value} AS INTEGER)`,
            count: count(),
          })
          .from(metricReadings)
          .where(
            and(
              metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
            ),
          )
          .groupBy(sql`CAST(${metricReadings.value} AS INTEGER)`)
          .orderBy(sql`CAST(${metricReadings.value} AS INTEGER)`),
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
            date: sql<string>`DATE(${metricReadings.occurredAt})::TEXT`,
            avgRating: sql<number>`ROUND(${avg(metricReadings.value)}::NUMERIC, 1)`,
          })
          .from(metricReadings)
          .where(
            and(
              metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
            ),
          )
          .groupBy(sql`DATE(${metricReadings.occurredAt})`)
          .orderBy(sql`DATE(${metricReadings.occurredAt})`),
      )

      return rows.map((r) => ({
        date: r.date,
        avgRating: Number(r.avgRating ?? 0),
      }))
    })
  },
})
