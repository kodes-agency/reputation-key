// Dashboard context — MetricStatsPort (facade port per ADR-0007)
// Aggregation queries against metric_readings data.
// Dashboard never imports metric_readings table directly — this port is the boundary.

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/**
 * Availability of one immutable governed Metric version for the requested
 * scope and period.
 *
 * - available: eligible evidence meets the version's minimum sample contract;
 * - insufficient_data: no governed evidence exists in the requested window;
 * - unavailable: evidence exists but does not satisfy the serving contract.
 *
 * This read has no projection-lifecycle evidence, so it cannot truthfully
 * claim that work is in flight.
 */
export type MetricStatsDataState = 'available' | 'insufficient_data' | 'unavailable'

export type MetricStatsEvidence = Readonly<{
  state: MetricStatsDataState
  definitionVersionId: string
  sampleCount: number
  minimumSample: number
}>

/** Metric key → governed summed value and source evidence. */
export type MetricSumRow = Readonly<{
  metricKey: string
  /** Null unless the source evidence is available. */
  total: number | null
}> &
  MetricStatsEvidence

export type MetricCountRow = Readonly<{
  metricKey: string
  /** Null unless the source evidence is available. */
  count: number | null
}> &
  MetricStatsEvidence

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

  /** Summed metric values grouped by metricKey for multiple portals+period. */
  getSumsByPortals(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalIds: ReadonlyArray<PortalId>,
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
