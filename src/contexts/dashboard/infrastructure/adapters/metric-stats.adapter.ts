// Dashboard context — Drizzle adapter implementing MetricStatsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings.
// BQC-5.5: scope predicates, the aggregate skeleton, and the statement
// timeout come from the read facade — methods are scope→skeleton wiring.

import type { Database } from '#/shared/db'
import { trace } from '#/shared/observability/trace'
import type { MetricStatsPort } from '../../application/ports/metric-stats.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import {
  metricPeriodWhere,
  metricPortalWhere,
  metricPortalsWhere,
  readMetricAggregates,
} from '../read-facade'

export const createMetricStatsAdapter = (db: Database): MetricStatsPort => ({
  async getSumsByPeriod(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ) {
    return trace('dashboard.metricStats.getSumsByPeriod', async () => {
      const rows = await readMetricAggregates(
        db,
        metricPeriodWhere(organizationId, propertyId, startDate, endDate),
      )
      return rows.map(({ metricKey, total }) => ({ metricKey, total }))
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
      const rows = await readMetricAggregates(
        db,
        metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
      )
      return rows.map(({ metricKey, total }) => ({ metricKey, total }))
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

      const rows = await readMetricAggregates(
        db,
        metricPortalsWhere(organizationId, propertyId, portalIds, startDate, endDate),
      )
      return rows.map(({ metricKey, total }) => ({ metricKey, total }))
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
      const rows = await readMetricAggregates(
        db,
        metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
      )
      return rows.map(({ metricKey, count }) => ({ metricKey, count }))
    })
  },
})
