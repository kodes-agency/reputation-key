import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { MetricPortalMetricEvidenceSet } from './portal-analytics.repository'

/** A Portal whose results are read, with the Property it belongs to. */
export type PortalResultsPortal = Readonly<{
  portalId: PortalId
  propertyId: PropertyId
}>

/** A half-open business-time window: `startAt` included, `endAt` excluded. */
export type PortalResultsWindow = Readonly<{
  startAt: Date
  endAt: Date
}>

/**
 * One governed measure of one Portal under one group, summed over a window.
 * `groupId` is the Portal's group when the guest acted (ADR 0040), not the
 * group it belongs to today: a Portal that moved keeps its earlier readings
 * under its old group, so it can have a cell per group it was in.
 * Same meaning as `PortalMetricSumRow`: qualified scans, Google opens only,
 * corrections applied.
 */
export type PortalResultsCell = Readonly<{
  portalId: PortalId
  groupId: PortalGroupId | null
  metricKey: string
  total: number
  count: number
}>

export type PortalResultsPortalEvidence = Readonly<{
  portalId: PortalId
  evidence: MetricPortalMetricEvidenceSet
}>

export type PortalResultsWindowReading = Readonly<{
  computedAt: Date
  /** Only cells with at least one counted reading; a missing cell is a verified zero. */
  cells: readonly PortalResultsCell[]
  /** Exactly one entry per requested Portal, in request order. */
  evidence: readonly PortalResultsPortalEvidence[]
}>

export type PortalResultsOverviewRepository = Readonly<{
  /**
   * Every requested Portal's governed sums and evidence for one window, in a
   * fixed number of statements however many Portals are asked about.
   */
  readWindow(
    input: Readonly<{
      organizationId: OrganizationId
      portals: readonly PortalResultsPortal[]
      window: PortalResultsWindow
    }>,
  ): Promise<PortalResultsWindowReading>
}>
