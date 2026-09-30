// Reporting application — getPortalResultsOverview.
//
// The Portals overview's results, for every Portal at once: one row per Portal,
// per Portal Group, per Property for its Portals in no group, per Property as a
// subtotal, and a total, each with the five measures of a single Portal's
// Results view and the same evidence states. Every window is read in one batch
// (the store answers for all the Portals that share it) and every row is
// assembled through `portalPeriodKpis`, so a row says what that Portal's own
// Results view says.
//
// Windows. A Portal's Results view builds its window in its Property's time zone
// (`timeRangeToDates`, `priorPeriodDates`). So does this read: the caller says
// which time zone each Property has, and Reporting builds each Property's
// window itself, the way the single-Portal view does. Properties that share a
// window share a read, so the number of statements follows the number of
// distinct windows (time zones), never the number of Portals. All Time is not a
// window here: a lifetime figure comes from the lifetime aggregate, not from
// readings, and the two would disagree.
//
// The caller passes the roster: the Portals in scope and the group each is in
// today. Portal owns that list; Reporting owns the numbers. Authorisation is
// the caller's (it has already narrowed the roster to what the person may see).
//
// Group figures follow the group each reading was recorded under (ADR 0040), so
// a Portal that moved keeps its earlier results with its old group. A group's
// evidence is the weakest of the Portals that feed it, and a Portal feeds every
// group any of its readings in the window sit under.

import type { PortalGroupId, PortalId, PropertyId } from '#/shared/domain/ids'
import type {
  PortalResultsGroupRow,
  PortalResultsMeasures,
  PortalResultsOverview,
  PortalResultsPeriod,
  PortalResultsPortalRow,
  PortalResultsPropertyRow,
  PortalResultsScope,
  PortalResultsTotalRow,
  PortalResultsUngroupedRow,
} from '../../domain/portal-results-overview'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import type { MetricPortalMetricEvidenceSet } from '../ports/portal-analytics.repository'
import type {
  PortalResultsCell,
  PortalResultsOverviewRepository,
  PortalResultsPortal,
  PortalResultsReadingGroup,
  PortalResultsWindowReading,
} from '../ports/portal-results-overview.repository'
import { priorPeriodDates, timeRangeToDates } from '../utils'
import { combineEvidence, sumCells } from './portal-results-aggregate'
import {
  portalPeriodKpis,
  type PortalPeriodKpis,
  type PortalPeriodReading,
} from './portal-period-kpis'
import { qualifiedScansSince } from './qualified-scans-since'

/** Portals one read will answer for; beyond it the caller must page or narrow. */
export const PORTAL_RESULTS_PORTAL_LIMIT = 1000

export type PortalResultsRosterEntry = Readonly<{
  portalId: PortalId
  propertyId: PropertyId
  /** The group the Portal is in today. */
  groupId: PortalGroupId | null
}>

/** A window preset the overview can read; All Time is a lifetime figure, not a window. */
export type PortalResultsTimeRange = Exclude<TimeRangePreset, 'all'>

export type PortalResultsPropertyZone = Readonly<{
  propertyId: PropertyId
  /** The Property's own IANA time zone, as its Portals' Results views use it. */
  timezone: string
}>

export type GetPortalResultsOverviewInput = Readonly<{
  scope: PortalResultsScope
  portals: readonly PortalResultsRosterEntry[]
  /** One per Property that has a Portal in the roster. */
  properties: readonly PortalResultsPropertyZone[]
  timeRange: PortalResultsTimeRange
  /** Also read the equal-length window before, as the Results view does. */
  compare: boolean
}>

export type GetPortalResultsOverviewDeps = Readonly<{
  results: PortalResultsOverviewRepository
  now: () => Date
}>

export type GetPortalResultsOverview = ReturnType<typeof getPortalResultsOverview>

function assertValidInput(input: GetPortalResultsOverviewInput): void {
  if ((input.timeRange as TimeRangePreset) === 'all') {
    throw new Error('Portal results need a bounded time range, not All Time')
  }
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
  const zones = new Set<PropertyId>()
  for (const zone of input.properties) {
    if (zones.has(zone.propertyId)) {
      throw new Error('Portal results lists a Property time zone more than once')
    }
    zones.add(zone.propertyId)
  }
  for (const portal of input.portals) {
    if (!zones.has(portal.propertyId)) {
      throw new Error(`Portal results has no time zone for Property ${portal.propertyId}`)
    }
  }
}

/** One Property's Portals and the windows they are read through. */
type PropertyPlan = Readonly<{
  propertyId: PropertyId
  entries: readonly PortalResultsRosterEntry[]
  range: PortalResultsPeriod
  compare: PortalResultsPeriod | null
}>

function planProperties(input: GetPortalResultsOverviewInput, now: Date): PropertyPlan[] {
  const zones = new Map(input.properties.map((zone) => [zone.propertyId, zone.timezone]))
  const byProperty = new Map<PropertyId, PortalResultsRosterEntry[]>()
  for (const entry of input.portals) {
    byProperty.set(entry.propertyId, [...(byProperty.get(entry.propertyId) ?? []), entry])
  }
  return [...byProperty].map(([propertyId, entries]) => {
    const timezone = zones.get(propertyId) ?? 'UTC'
    const { startDate, endDate } = timeRangeToDates(input.timeRange, now, timezone)
    const prior = input.compare
      ? priorPeriodDates(input.timeRange, startDate, endDate, timezone)
      : null
    return {
      propertyId,
      entries,
      range: { startAt: startDate, endAt: endDate },
      compare: prior && { startAt: prior.priorStartDate, endAt: prior.priorEndDate },
    }
  })
}

/** One Property's view of one window: only its Portals' cells, groups and evidence. */
type WindowIndex = Readonly<{
  period: PortalResultsPeriod
  computedAt: Date
  cells: readonly PortalResultsCell[]
  readingGroups: readonly PortalResultsReadingGroup[]
  evidence: ReadonlyMap<PortalId, MetricPortalMetricEvidenceSet>
}>

function indexWindow(
  period: PortalResultsPeriod,
  reading: PortalResultsWindowReading,
  entries: readonly PortalResultsRosterEntry[],
): WindowIndex {
  const own = new Set(entries.map((entry) => entry.portalId))
  const evidence = new Map(reading.evidence.map((row) => [row.portalId, row.evidence]))
  for (const portalId of own) {
    if (!evidence.has(portalId)) {
      throw new Error(`Portal results store returned no evidence for Portal ${portalId}`)
    }
  }
  return {
    period,
    computedAt: reading.computedAt,
    // A reading for a Portal that is not this Property's is not this row's to count.
    cells: reading.cells.filter((cell) => own.has(cell.portalId)),
    readingGroups: reading.readingGroups.filter((pair) => own.has(pair.portalId)),
    evidence: new Map([...evidence].filter(([portalId]) => own.has(portalId))),
  }
}

const windowKey = (period: PortalResultsPeriod) =>
  `${period.startAt.getTime()}/${period.endAt.getTime()}`

type Property = Readonly<{
  plan: PropertyPlan
  current: WindowIndex
  prior: WindowIndex | null
}>

/**
 * Read every distinct window once, asking each only about the Portals of the
 * Properties that use it, then hand each Property its own view.
 */
async function readProperties(
  deps: GetPortalResultsOverviewDeps,
  organizationId: PortalResultsScope['organizationId'],
  plans: readonly PropertyPlan[],
): Promise<Property[]> {
  const requests = new Map<
    string,
    { period: PortalResultsPeriod; portals: PortalResultsPortal[] }
  >()
  for (const plan of plans) {
    const portals = plan.entries.map(({ portalId, propertyId }) => ({
      portalId,
      propertyId,
    }))
    for (const period of [plan.range, plan.compare]) {
      if (!period) continue
      const key = windowKey(period)
      const request = requests.get(key) ?? { period, portals: [] }
      requests.set(key, { period, portals: [...request.portals, ...portals] })
    }
  }
  const readings = new Map<string, PortalResultsWindowReading>(
    await Promise.all(
      [...requests].map(async ([key, { period, portals }]) => {
        const reading = await deps.results.readWindow({
          organizationId,
          portals,
          window: period,
        })
        return [key, reading] as const
      }),
    ),
  )
  const indexFor = (plan: PropertyPlan, period: PortalResultsPeriod): WindowIndex => {
    const reading = readings.get(windowKey(period))
    if (!reading) throw new Error('Portal results window was not read')
    return indexWindow(period, reading, plan.entries)
  }
  return plans.map((plan) => ({
    plan,
    current: indexFor(plan, plan.range),
    prior: plan.compare ? indexFor(plan, plan.compare) : null,
  }))
}

/** A row's reading of a window: the cells it counts and the Portals that vouch for them. */
function windowReading(
  parts: readonly WindowIndex[],
  portalIds: readonly PortalId[],
  keepCell: (cell: PortalResultsCell) => boolean,
): PortalPeriodReading {
  const sets = portalIds.flatMap((id) => {
    const evidence = parts.find((part) => part.evidence.has(id))?.evidence.get(id)
    return evidence ? [evidence] : []
  })
  const earliest = Math.min(...parts.map((part) => part.period.startAt.getTime()))
  const latest = Math.max(...parts.map((part) => part.computedAt.getTime()))
  return {
    // Where the earliest part opens: the honest side for "before scans counted".
    startDate: new Date(earliest),
    sums: sumCells(parts.flatMap((part) => part.cells).filter(keepCell)),
    evidence: combineEvidence(sets, new Date(latest)),
  }
}

type Readings = Readonly<{
  current: readonly WindowIndex[]
  prior: readonly WindowIndex[] | null
}>

function measuresOf(result: PortalPeriodKpis): PortalResultsMeasures {
  return { kpis: result.kpis, engagementFunnel: result.engagementFunnel }
}

function makeReader(since: Date) {
  return (
    { current, prior }: Readings,
    portalIds: readonly PortalId[],
    keepCell: (cell: PortalResultsCell) => boolean = () => true,
  ): PortalResultsMeasures =>
    measuresOf(
      portalPeriodKpis(
        windowReading(current, portalIds, keepCell),
        prior && windowReading(prior, portalIds, keepCell),
        since,
      ),
    )
}

type Membership = Readonly<{
  memberPortalIds: PortalId[]
  contributingPortalIds: PortalId[]
}>

/**
 * The Portals a group (or the ungrouped row) is made of: those in it today, and
 * those with a reading in either window recorded under it. Roster order.
 */
function membership(
  entries: readonly PortalResultsRosterEntry[],
  windows: readonly WindowIndex[],
  groupId: PortalGroupId | null,
): Membership {
  const underIt = new Set(
    windows
      .flatMap((window) => [
        ...window.cells.filter((cell) => cell.groupId === groupId),
        ...window.readingGroups.filter((pair) => pair.groupId === groupId),
      ])
      .map((row) => row.portalId),
  )
  const members = entries.filter((entry) => entry.groupId === groupId)
  return {
    memberPortalIds: members.map((entry) => entry.portalId),
    contributingPortalIds: entries
      .filter((entry) => entry.groupId === groupId || underIt.has(entry.portalId))
      .map((entry) => entry.portalId),
  }
}

function groupIdsOf(
  entries: readonly PortalResultsRosterEntry[],
  windows: readonly WindowIndex[],
): PortalGroupId[] {
  const ids = new Set<PortalGroupId>()
  for (const entry of entries) if (entry.groupId) ids.add(entry.groupId)
  for (const window of windows) {
    for (const cell of window.cells) if (cell.groupId) ids.add(cell.groupId)
    for (const pair of window.readingGroups) if (pair.groupId) ids.add(pair.groupId)
  }
  return [...ids].sort()
}

type PropertyRows = Readonly<{
  property: PortalResultsPropertyRow
  portals: PortalResultsPortalRow[]
  groups: PortalResultsGroupRow[]
  ungrouped: PortalResultsUngroupedRow
}>

function rowsForProperty(
  { plan, current, prior }: Property,
  read: ReturnType<typeof makeReader>,
): PropertyRows {
  const { propertyId, entries } = plan
  const own: Readings = { current: [current], prior: prior && [prior] }
  const windows = prior ? [current, prior] : [current]
  const portalIds = entries.map((entry) => entry.portalId)
  const noGroup = membership(entries, windows, null)
  return {
    property: {
      propertyId,
      period: plan.range,
      comparePeriod: plan.compare,
      portalIds,
      ...read(own, portalIds),
    },
    portals: entries.map((entry) => ({
      portalId: entry.portalId,
      propertyId,
      groupId: entry.groupId,
      ...read(own, [entry.portalId], (cell) => cell.portalId === entry.portalId),
    })),
    groups: groupIdsOf(entries, windows).map((groupId) => {
      const members = membership(entries, windows, groupId)
      return {
        propertyId,
        groupId,
        ...members,
        ...read(own, members.contributingPortalIds, (cell) => cell.groupId === groupId),
      }
    }),
    ungrouped: {
      propertyId,
      ...noGroup,
      ...read(own, noGroup.contributingPortalIds, (cell) => cell.groupId === null),
    },
  }
}

/** Nothing to read: a window with no readings, so a total over no Portals is a ready zero. */
function emptyWindow(period: PortalResultsPeriod, computedAt: Date): WindowIndex {
  return { period, computedAt, cells: [], readingGroups: [], evidence: new Map() }
}

/** The total's readings: every Property's own window, added together. */
function totalReadings(
  input: GetPortalResultsOverviewInput,
  properties: readonly Property[],
  now: Date,
): Readings {
  if (properties.length === 0) {
    // No Property says which time zone; UTC stands in for an empty total.
    const { startDate, endDate } = timeRangeToDates(input.timeRange, now, 'UTC')
    const prior = input.compare
      ? priorPeriodDates(input.timeRange, startDate, endDate, 'UTC')
      : null
    return {
      current: [emptyWindow({ startAt: startDate, endAt: endDate }, now)],
      prior: prior && [
        emptyWindow({ startAt: prior.priorStartDate, endAt: prior.priorEndDate }, now),
      ],
    }
  }
  const priors = properties.flatMap((property) =>
    property.prior ? [property.prior] : [],
  )
  return {
    current: properties.map((property) => property.current),
    prior: input.compare && priors.length === properties.length ? priors : null,
  }
}

export const getPortalResultsOverview =
  (deps: GetPortalResultsOverviewDeps) =>
  async (input: GetPortalResultsOverviewInput): Promise<PortalResultsOverview> => {
    assertValidInput(input)
    const now = deps.now()
    const properties = await readProperties(
      deps,
      input.scope.organizationId,
      planProperties(input, now),
    )
    const since = qualifiedScansSince()
    const read = makeReader(since)

    const rows = properties.map((property) => rowsForProperty(property, read))
    const allIds = input.portals.map((entry) => entry.portalId)
    const total: PortalResultsTotalRow = {
      portalIds: allIds,
      ...read(totalReadings(input, properties, now), allIds),
    }
    const rowByPortal = new Map(
      rows.flatMap((row) => row.portals).map((row) => [row.portalId, row] as const),
    )

    return {
      qualifiedScansSince: since,
      properties: rows.map((row) => row.property),
      portals: input.portals.flatMap((entry) => {
        const row = rowByPortal.get(entry.portalId)
        return row ? [row] : []
      }),
      groups: rows.flatMap((row) => row.groups),
      ungrouped: rows.map((row) => row.ungrouped),
      total,
    }
  }
