// Reporting domain — the shape of the Portals overview results.
//
// One row per Portal, one per Portal Group, one for Portals in no group, and a
// total. Every row carries the same five measures as a single Portal's Results
// view (`PortalKPIs`), with the same evidence states: a figure that is not safe
// to serve is null, never zero. Identifiers only: names live with Portal.

import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { PortalKPIs } from './dashboard-types'

export type PortalResultsPeriod = Readonly<{ startAt: Date; endAt: Date }>

export type PortalResultsPortalRow = Readonly<{
  portalId: PortalId
  propertyId: PropertyId
  /** The group the Portal is in today; its history may sit under others. */
  groupId: PortalGroupId | null
  kpis: PortalKPIs
}>

export type PortalResultsGroupRow = Readonly<{
  groupId: PortalGroupId
  /**
   * Portals in the group today, plus Portals whose readings in the window sit
   * under it (they moved out since). The group's evidence covers all of them.
   */
  portalIds: readonly PortalId[]
  kpis: PortalKPIs
}>

export type PortalResultsAggregateRow = Readonly<{
  portalIds: readonly PortalId[]
  kpis: PortalKPIs
}>

export type PortalResultsOverview = Readonly<{
  period: PortalResultsPeriod
  /** Null when no comparison was asked for. */
  comparePeriod: PortalResultsPeriod | null
  /** The day qualified scans began counting, from the metric registry. */
  qualifiedScansSince: Date
  portals: readonly PortalResultsPortalRow[]
  groups: readonly PortalResultsGroupRow[]
  /** Readings under no group. Always present; `portalIds` is empty when none apply. */
  ungrouped: PortalResultsAggregateRow
  total: PortalResultsAggregateRow
}>

/** Where the results are read: one Property, or the whole Organization. */
export type PortalResultsScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId | null
}>
