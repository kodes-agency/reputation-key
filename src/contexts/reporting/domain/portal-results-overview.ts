// Reporting domain — the shape of the Portals overview results.
//
// One row per Portal, one per Portal Group, one per Property for the Portals in
// no group, one per Property as its subtotal, and a total. Every row carries the
// same five measures as a single Portal's Results view (`PortalKPIs`), with the
// same evidence states: a figure that is not safe to serve is null, never zero.
// Identifiers only: names live with Portal.
//
// A Property reads its own window, in its own time zone, exactly as its Portals'
// Results views do. The total adds Property readings that may sit in different
// windows, so it carries no period of its own.

import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type {
  PortalEngagementFunnel,
  PortalKPIs,
  PortalResultsThresholds,
} from './dashboard-types'

export type PortalResultsPeriod = Readonly<{ startAt: Date; endAt: Date }>

/** What every row says: the five measures and the scan funnel behind the strip. */
export type PortalResultsMeasures = Readonly<{
  kpis: PortalKPIs
  /** Ratings as a share of qualified scans, held back where that would exceed 100%. */
  engagementFunnel: PortalEngagementFunnel | null
}>

export type PortalResultsPortalRow = PortalResultsMeasures &
  Readonly<{
    portalId: PortalId
    propertyId: PropertyId
    /** The group the Portal is in today; its history may sit under others. */
    groupId: PortalGroupId | null
  }>

/**
 * The Portals a group (or the ungrouped row) is made of. Show `memberPortalIds`
 * for "3 portals"; `contributingPortalIds` also holds Portals that moved out
 * since but whose readings in the window sit under the group, so the row's
 * evidence covers them.
 */
export type PortalResultsMembership = Readonly<{
  /** Portals in the group today. */
  memberPortalIds: readonly PortalId[]
  /** Members, plus Portals whose readings or source facts in the window sit under it. */
  contributingPortalIds: readonly PortalId[]
}>

export type PortalResultsGroupRow = PortalResultsMeasures &
  PortalResultsMembership &
  Readonly<{
    propertyId: PropertyId
    groupId: PortalGroupId
  }>

/** One Property's Portals in no group, and readings recorded under no group. */
export type PortalResultsUngroupedRow = PortalResultsMeasures &
  PortalResultsMembership &
  Readonly<{ propertyId: PropertyId }>

/**
 * The window as Property-local calendar days (`YYYY-MM-DD`, both ends
 * inclusive), for labels like "1-30 Sep" that a client must not work out from
 * instants and a zone. The comparison days are null when none was asked for.
 */
export type PortalResultsLocalDays = Readonly<{
  start: string
  end: string
  compareStart: string | null
  compareEnd: string | null
}>

/** One Property's subtotal, over the window in that Property's local time. */
export type PortalResultsPropertyRow = PortalResultsMeasures &
  Readonly<{
    propertyId: PropertyId
    /** The Property's own IANA time zone, the one its window was cut in. */
    timezone: string
    period: PortalResultsPeriod
    /** Null when no comparison was asked for. */
    comparePeriod: PortalResultsPeriod | null
    localDays: PortalResultsLocalDays
    portalIds: readonly PortalId[]
  }>

export type PortalResultsTotalRow = PortalResultsMeasures &
  Readonly<{ portalIds: readonly PortalId[] }>

export type PortalResultsOverview = Readonly<{
  /** The day qualified scans began counting, from the metric registry. */
  qualifiedScansSince: Date
  /** The sample floors the server applied, so a client never keeps a copy. */
  thresholds: PortalResultsThresholds
  /** In roster order of first appearance; one per Property that has a Portal. */
  properties: readonly PortalResultsPropertyRow[]
  portals: readonly PortalResultsPortalRow[]
  /** Grouped by Property, then by group id. */
  groups: readonly PortalResultsGroupRow[]
  /** One per Property that has a Portal; `memberPortalIds` is empty when none apply. */
  ungrouped: readonly PortalResultsUngroupedRow[]
  total: PortalResultsTotalRow
}>

/** Where the results are read: one Property, or the whole Organization. */
export type PortalResultsScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId | null
}>
