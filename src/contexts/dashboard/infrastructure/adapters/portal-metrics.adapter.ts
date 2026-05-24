// Dashboard context — Drizzle adapter implementing PortalMetricsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings for portal analytics.

import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import { and, sum, eq, gte, lte, sql, count, avg } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { PortalMetricsPort, PortalRatingBucket, PortalRatingTrendPoint } from '../../application/ports/portal-metrics.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

export function createPortalMetricsAdapter(db: Database): PortalMetricsPort {
  return {
    async getPortalKpiSums(
      organizationId: OrganizationId,
      propertyId: PropertyId,
      portalId: PortalId,
      startDate: Date,
      endDate: Date,
    ) {
      return trace('dashboard.portalMetrics.getPortalKpiSums', async () => {
        const rows = await db
          .select({
            metricKey: metricReadings.metricKey,
            total: sum(metricReadings.value),
            count: count(metricReadings.value),
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              eq(metricReadings.portalId, portalId),
              gte(metricReadings.recordedAt, startDate),
              lte(metricReadings.recordedAt, endDate),
            ),
          )
          .groupBy(metricReadings.metricKey)

        return rows.map((r) => ({
          metricKey: r.metricKey,
          total: Number(r.total ?? 0),
          count: Number(r.count ?? 0),
        }))
      })
    },

    async getPortalRatingDistribution(
      organizationId: OrganizationId,
      propertyId: PropertyId,
      portalId: PortalId,
      startDate: Date,
      endDate: Date,
    ): Promise<readonly PortalRatingBucket[]> {
      return trace('dashboard.portalMetrics.getPortalRatingDistribution', async () => {
        const rows = await db
          .select({
            stars: sql<number>`CAST(${metricReadings.value} AS INTEGER)`,
            count: count(),
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              eq(metricReadings.portalId, portalId),
              eq(metricReadings.metricKey, 'portal.rating'),
              gte(metricReadings.recordedAt, startDate),
              lte(metricReadings.recordedAt, endDate),
            ),
          )
          .groupBy(sql`CAST(${metricReadings.value} AS INTEGER)`)
          .orderBy(sql`CAST(${metricReadings.value} AS INTEGER)`)

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
        const rows = await db
          .select({
            date: sql<string>`DATE(${metricReadings.recordedAt})::TEXT`,
            avgRating: sql<number>`ROUND(${avg(metricReadings.value)}::NUMERIC, 1)`,
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              eq(metricReadings.portalId, portalId),
              eq(metricReadings.metricKey, 'portal.rating'),
              gte(metricReadings.recordedAt, startDate),
              lte(metricReadings.recordedAt, endDate),
            ),
          )
          .groupBy(sql`DATE(${metricReadings.recordedAt})`)
          .orderBy(sql`DATE(${metricReadings.recordedAt})`)

        return rows.map((r) => ({
          date: r.date,
          avgRating: Number(r.avgRating ?? 0),
        }))
      })
    },
  }
}
