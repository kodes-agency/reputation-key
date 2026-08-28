// Dashboard context — Drizzle adapter implementing MetricStatsPort
// SQL queries against metric_readings table.
// This is the ONLY place dashboard infrastructure touches metric_readings.
// BQC-5.5: scope predicates, the aggregate skeleton, and the statement
// timeout come from the read facade — methods are scope→skeleton wiring.

import type { Database } from '#/shared/db'
import { trace } from '#/shared/observability/trace'
import type {
  MetricCountRow,
  MetricStatsEvidence,
  MetricStatsPort,
  MetricSumRow,
} from '../../application/ports/metric-stats.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import {
  metricPeriodWhere,
  metricPortalWhere,
  metricPortalsWhere,
  readMetricAggregates,
  type MetricAggregateRow,
} from '../read-facade'

function sourceEvidence(row: MetricAggregateRow): MetricStatsEvidence {
  return {
    state: row.state,
    definitionVersionId: row.definitionVersionId,
    sampleCount: row.sampleCount,
    minimumSample: row.minimumSample,
  }
}

function sumRows(rows: readonly MetricAggregateRow[]): readonly MetricSumRow[] {
  return rows.map((row) => ({
    metricKey: row.metricKey,
    total: row.state === 'available' ? row.total : null,
    ...sourceEvidence(row),
  }))
}

function countRows(rows: readonly MetricAggregateRow[]): readonly MetricCountRow[] {
  return rows.map((row) => ({
    metricKey: row.metricKey,
    count: row.state === 'available' ? row.count : null,
    ...sourceEvidence(row),
  }))
}

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
      return sumRows(rows)
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
      return sumRows(rows)
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
      return sumRows(rows)
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
      return countRows(rows)
    })
  },
})
