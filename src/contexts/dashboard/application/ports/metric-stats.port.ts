// Dashboard context — MetricStatsPort (facade port per ADR-0007)
// Aggregation queries against metric_readings data.
// Dashboard never imports metric_readings table directly — this port is the boundary.

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/** Metric key → summed value. */
export type MetricSumRow = Readonly<{
  metricKey: string
  total: number
}>

export type MetricCountRow = Readonly<{
  metricKey: string
  count: number
}>

export type MetricStatsPort = Readonly<{
  /** Summed metric values grouped by metricKey for a property+period. */
  getSumsByPeriod(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly MetricSumRow[]>

  /** Summed metric values grouped by metricKey for a portal+period. */
  getSumsByPortal(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly MetricSumRow[]>

  /** Count of readings grouped by metricKey for a portal+period. */
  getCountsByPortal(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly MetricCountRow[]>
}>
