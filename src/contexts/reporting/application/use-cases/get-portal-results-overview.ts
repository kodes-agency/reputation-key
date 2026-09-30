// Reporting application — getPortalResultsOverview.
//
// The Portals overview's results, for every Portal at once: one row per Portal,
// per Portal Group, for Portals in no group, and a total, each with the five
// measures of a single Portal's Results view and the same evidence states. It
// reads each window in one batch (the store answers for all Portals together)
// and assembles every row through `portalPeriodKpis`, so a row can never say
// something a Portal's own Results view would not.
//
// The caller passes the roster: the Portals in scope and the group each is in
// today. Portal owns that list; Reporting owns the numbers. Authorisation is
// the caller's (it has already narrowed the roster to what the person may see).
//
// Group figures follow the group each reading was recorded under (ADR 0040), so
// a Portal that moved keeps its earlier results with its old group. A group's
// evidence is the weakest of the Portals that feed it.

import type { PortalGroupId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PortalKPIs } from '../../domain/dashboard-types'
import type {
  PortalResultsAggregateRow,
  PortalResultsGroupRow,
  PortalResultsOverview,
  PortalResultsPeriod,
  PortalResultsPortalRow,
  PortalResultsScope,
} from '../../domain/portal-results-overview'
import type { MetricPortalMetricEvidenceSet } from '../ports/portal-analytics.repository'
import type {
  PortalResultsCell,
  PortalResultsOverviewRepository,
  PortalResultsWindowReading,
} from '../ports/portal-results-overview.repository'
import { combineEvidence, sumCells } from './portal-results-aggregate'
import { portalPeriodKpis, type PortalPeriodReading } from './portal-period-kpis'
import { qualifiedScansSince } from './qualified-scans-since'

/** Portals one read will answer for; beyond it the caller must page or narrow. */
export const PORTAL_RESULTS_PORTAL_LIMIT = 1000

export type PortalResultsRosterEntry = Readonly<{
  portalId: PortalId
  propertyId: PropertyId
  /** The group the Portal is in today. */
  groupId: PortalGroupId | null
}>

export type GetPortalResultsOverviewInput = Readonly<{
  scope: PortalResultsScope
  portals: readonly PortalResultsRosterEntry[]
  /** The window shown. Half-open, in business time; All Time is not a window here. */
  range: PortalResultsPeriod
  /** The window to compare against, or null for no comparison. */
  compare: PortalResultsPeriod | null
}>

export type GetPortalResultsOverviewDeps = Readonly<{
  results: PortalResultsOverviewRepository
}>

export type GetPortalResultsOverview = ReturnType<typeof getPortalResultsOverview>

function assertValidPeriod(period: PortalResultsPeriod): void {
  if (
    Number.isNaN(period.startAt.getTime()) ||
    Number.isNaN(period.endAt.getTime()) ||
    period.startAt >= period.endAt
  ) {
    throw new Error('Portal results period is invalid')
  }
}

function assertValidInput(input: GetPortalResultsOverviewInput): void {
  assertValidPeriod(input.range)
  if (input.compare) assertValidPeriod(input.compare)
  if (input.portals.length > PORTAL_RESULTS_PORTAL_LIMIT) {
    throw new Error(
      `Portal results asked about too many Portals (limit ${PORTAL_RESULTS_PORTAL_LIMIT})`,
    )
  }
  const seen = new Set<PortalId>()
  for (const portal of input.portals) {
    if (seen.has(portal.portalId)) {
      throw new Error('Portal results roster lists a Portal more than once')
    }
    seen.add(portal.portalId)
    if (input.scope.propertyId !== null && portal.propertyId !== input.scope.propertyId) {
      throw new Error(
        'Portal results roster holds a Portal outside the requested Property',
      )
    }
  }
}

/** One window's cells and evidence, indexed for the rows built from them. */
type WindowIndex = Readonly<{
  period: PortalResultsPeriod
  computedAt: Date
  cells: readonly PortalResultsCell[]
  evidence: ReadonlyMap<PortalId, MetricPortalMetricEvidenceSet>
}>

function indexWindow(
  period: PortalResultsPeriod,
  reading: PortalResultsWindowReading,
  roster: ReadonlySet<PortalId>,
): WindowIndex {
  const evidence = new Map(reading.evidence.map((row) => [row.portalId, row.evidence]))
  for (const portalId of roster) {
    if (!evidence.has(portalId)) {
      throw new Error(`Portal results store returned no evidence for Portal ${portalId}`)
    }
  }
  return {
    period,
    computedAt: reading.computedAt,
    // A reading for a Portal outside the roster is not this caller's to count.
    cells: reading.cells.filter((cell) => roster.has(cell.portalId)),
    evidence,
  }
}

/** A row's reading of one window: the cells it counts and the Portals that vouch for them. */
function windowReading(
  window: WindowIndex,
  portalIds: readonly PortalId[],
  keepCell: (cell: PortalResultsCell) => boolean,
): PortalPeriodReading {
  const sets = portalIds.flatMap((id) => {
    const evidence = window.evidence.get(id)
    return evidence ? [evidence] : []
  })
  return {
    startDate: window.period.startAt,
    sums: sumCells(window.cells.filter(keepCell)),
    evidence: combineEvidence(sets, window.computedAt),
  }
}

function kpisFor(
  current: WindowIndex,
  prior: WindowIndex | null,
  portalIds: readonly PortalId[],
  keepCell: (cell: PortalResultsCell) => boolean,
  since: Date,
): PortalKPIs {
  return portalPeriodKpis(
    windowReading(current, portalIds, keepCell),
    prior && windowReading(prior, portalIds, keepCell),
    since,
  ).kpis
}

/**
 * The Portals a group (or the ungrouped row) speaks for: those in it today and
 * those whose readings in either window were recorded under it. Roster order.
 */
function contributors(
  roster: readonly PortalResultsRosterEntry[],
  windows: readonly WindowIndex[],
  groupId: PortalGroupId | null,
): PortalId[] {
  const withReadings = new Set(
    windows.flatMap((window) =>
      window.cells
        .filter((cell) => cell.groupId === groupId)
        .map((cell) => cell.portalId),
    ),
  )
  return roster
    .filter((entry) => entry.groupId === groupId || withReadings.has(entry.portalId))
    .map((entry) => entry.portalId)
}

function groupIdsOf(
  roster: readonly PortalResultsRosterEntry[],
  windows: readonly WindowIndex[],
): PortalGroupId[] {
  const ids = new Set<PortalGroupId>()
  for (const entry of roster) if (entry.groupId) ids.add(entry.groupId)
  for (const window of windows) {
    for (const cell of window.cells) if (cell.groupId) ids.add(cell.groupId)
  }
  return [...ids].sort()
}

export const getPortalResultsOverview =
  (deps: GetPortalResultsOverviewDeps) =>
  async (input: GetPortalResultsOverviewInput): Promise<PortalResultsOverview> => {
    assertValidInput(input)
    const { scope, portals: roster, range, compare } = input
    const requested = roster.map(({ portalId, propertyId }) => ({ portalId, propertyId }))
    const rosterIds = new Set(roster.map((entry) => entry.portalId))
    const read = (window: PortalResultsPeriod) =>
      deps.results.readWindow({
        organizationId: scope.organizationId,
        portals: requested,
        window,
      })

    const [currentReading, priorReading] = await Promise.all([
      read(range),
      compare ? read(compare) : Promise.resolve(null),
    ])
    const current = indexWindow(range, currentReading, rosterIds)
    const prior =
      compare && priorReading ? indexWindow(compare, priorReading, rosterIds) : null
    const windows = prior ? [current, prior] : [current]
    const since = qualifiedScansSince()

    const portals: PortalResultsPortalRow[] = roster.map((entry) => ({
      portalId: entry.portalId,
      propertyId: entry.propertyId,
      groupId: entry.groupId,
      kpis: kpisFor(
        current,
        prior,
        [entry.portalId],
        (cell) => cell.portalId === entry.portalId,
        since,
      ),
    }))

    const groups: PortalResultsGroupRow[] = groupIdsOf(roster, windows).map((groupId) => {
      const portalIds = contributors(roster, windows, groupId)
      return {
        groupId,
        portalIds,
        kpis: kpisFor(
          current,
          prior,
          portalIds,
          (cell) => cell.groupId === groupId,
          since,
        ),
      }
    })

    const ungroupedIds = contributors(roster, windows, null)
    const ungrouped: PortalResultsAggregateRow = {
      portalIds: ungroupedIds,
      kpis: kpisFor(current, prior, ungroupedIds, (cell) => cell.groupId === null, since),
    }

    const allIds = roster.map((entry) => entry.portalId)
    const total: PortalResultsAggregateRow = {
      portalIds: allIds,
      kpis: kpisFor(current, prior, allIds, () => true, since),
    }

    return {
      period: range,
      comparePeriod: compare,
      qualifiedScansSince: since,
      portals,
      groups,
      ungrouped,
      total,
    }
  }
