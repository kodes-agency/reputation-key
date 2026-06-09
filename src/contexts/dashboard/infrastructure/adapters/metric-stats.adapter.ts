// Dashboard context — Drizzle adapter implementing MetricStatsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings.

import type { Database } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import { and, sum, count, eq, gte, lte, inArray } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { MetricStatsPort } from '../../application/ports/metric-stats.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

export function createMetricStatsAdapter(db: Database): MetricStatsPort {
  return {
    async getSumsByPeriod(
      organizationId: OrganizationId,
      propertyId: PropertyId,
      startDate: Date,
      endDate: Date,
    ) {
      return trace('dashboard.metricStats.getSumsByPeriod', async () => {
        const rows = await db
          .select({
            metricKey: metricReadings.metricKey,
            total: sum(metricReadings.value),
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              gte(metricReadings.occurredAt, startDate),
              lte(metricReadings.occurredAt, endDate),
            ),
          )
          .groupBy(metricReadings.metricKey)

        return rows.map((r) => ({
          metricKey: r.metricKey,
          total: Number(r.total ?? 0),
        }))
      })
    },

    async getSumsByPortal(
      organizationId: OrganizationId,
      propertyId: PropertyId,
      portalId: PortalId,
      startDate: Date,
      endDate: Date,
    ) {
      return trace('dashboard.metricStats.getSumsByPortal', async () => {
        const rows = await db
          .select({
            metricKey: metricReadings.metricKey,
            total: sum(metricReadings.value),
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              eq(metricReadings.portalId, portalId),
              gte(metricReadings.occurredAt, startDate),
              lte(metricReadings.occurredAt, endDate),
            ),
          )
          .groupBy(metricReadings.metricKey)

        return rows.map((r) => ({
          metricKey: r.metricKey,
          total: Number(r.total ?? 0),
        }))
      })
    },

    async getSumsByPortals(
      organizationId: OrganizationId,
      propertyId: PropertyId,
      portalIds: ReadonlyArray<PortalId>,
      startDate: Date,
      endDate: Date,
    ) {
      return trace('dashboard.metricStats.getSumsByPortals', async () => {
        if (portalIds.length === 0) return []

        const rows = await db
          .select({
            metricKey: metricReadings.metricKey,
            total: sum(metricReadings.value),
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              // Drizzle inArray() doesn't accept branded PortalId[] — cast to string[] is safe because PortalId is a string-brand.
              inArray(metricReadings.portalId, portalIds as unknown as string[]),
              gte(metricReadings.occurredAt, startDate),
              lte(metricReadings.occurredAt, endDate),
            ),
          )
          .groupBy(metricReadings.metricKey)

        return rows.map((r) => ({
          metricKey: r.metricKey,
          total: Number(r.total ?? 0),
        }))
      })
    },

    async getCountsByPortal(
      organizationId: OrganizationId,
      propertyId: PropertyId,
      portalId: PortalId,
      startDate: Date,
      endDate: Date,
    ) {
      return trace('dashboard.metricStats.getCountsByPortal', async () => {
        const rows = await db
          .select({
            metricKey: metricReadings.metricKey,
            count: count(),
          })
          .from(metricReadings)
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              eq(metricReadings.portalId, portalId),
              gte(metricReadings.occurredAt, startDate),
              lte(metricReadings.occurredAt, endDate),
            ),
          )
          .groupBy(metricReadings.metricKey)

        return rows.map((r) => ({
          metricKey: r.metricKey,
          count: Number(r.count ?? 0),
        }))
      })
    },
  }
}
