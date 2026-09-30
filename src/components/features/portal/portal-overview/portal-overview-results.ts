// The Portals overview's results as the page prints them: a figure per measure
// for every Portal, group and Property row, and the strip above the table. Pure:
// the read (`getPortalResultsOverview`) says what was counted and how sure it is,
// and every word here comes from the same cell builder a single Portal's Results
// view prints with (`measureCells`). The strip's "% of scans" is the exception
// to "the same cells": it is the engagement funnel's share, which is withheld
// unless scans, ratings and Google opens are all ready, where the Results tab
// works a share out from the counts it has.
//
// A figure that is not safe to serve is a dash with its reason, never a zero.
// An average the sample is too small to show says "Too few" and how many there
// are, because that is a different situation from one still being processed.
import type {
  PortalResultsMeasures,
  PortalResultsOverview,
  PortalResultsPropertyRow,
  PortalResultsThresholds,
} from '#/contexts/reporting/application/public-api'
import { isDarkCapabilityDenial } from '#/shared/auth/capability-denial'
import {
  BELOW_MINIMUM_SAMPLE,
  DASH,
  formatCount,
  measureCells,
  type ResultsCell,
  type ResultsMeasuresInput,
} from '../portal-analytics/portal-results-cells'
import {
  currentPeriodLabel,
  windowCaption,
} from '../portal-analytics/portal-results-window'

/** `missing`: no figure (still processing, or cannot be counted). `withheld`: too small to show. */
export type MeasureTone = 'figure' | 'withheld' | 'missing'

export type MeasureFigure = Readonly<{
  text: string
  /** `star` draws the rating star after the figure. */
  unit: 'star' | null
  tone: MeasureTone
  /** Why there is no figure; heard by a screen reader and seen on hover. */
  reason: string | null
}>

export type RowMeasures = Readonly<{
  scans: MeasureFigure
  ratings: MeasureFigure
  average: MeasureFigure
  googleOpens: MeasureFigure
  notes: MeasureFigure
  /** One line for the stacked layout: "412 qualified scans · 4.4 ★ from 118". */
  summary: string | null
}>

export type MeasureFrame = Readonly<{
  thresholds: PortalResultsThresholds
  timezone: string
}>

const TOO_FEW = 'Too few'

function figureOf(cell: ResultsCell | undefined): MeasureFigure {
  if (!cell || cell.value === DASH) {
    return { text: DASH, unit: null, tone: 'missing', reason: cell?.detail ?? null }
  }
  return { text: cell.value, unit: cell.unit, tone: 'figure', reason: null }
}

function scansWord(count: number | null, style: 'long' | 'short'): string {
  const plural = count !== 1
  if (style === 'short') return plural ? 'scans' : 'scan'
  return plural ? 'qualified scans' : 'qualified scan'
}

function summaryOf(
  measures: PortalResultsMeasures,
  scans: MeasureFigure,
  average: MeasureFigure,
  style: 'long' | 'short',
): string | null {
  if (scans.tone !== 'figure') return null
  const head = `${scans.text} ${scansWord(measures.kpis.scans.value, style)}`
  if (average.tone !== 'figure') return head
  return `${head} · ${average.text} ★ from ${formatCount(measures.kpis.avgRating.sampleCount)}`
}

/**
 * The five figures of one row. `short` writes the group head's summary ("698
 * scans · 4.5 ★ from 209"), `long` a Portal's ("412 qualified scans · 4.4 ★ from 118").
 */
export function rowMeasures(
  measures: PortalResultsMeasures,
  frame: MeasureFrame,
  style: 'long' | 'short' = 'long',
): RowMeasures {
  const input: ResultsMeasuresInput = { ...frame, kpis: measures.kpis, localDays: null }
  const cells = measureCells(input, { compare: false })
  const byKey = (key: ResultsCell['key']) => cells.find((cell) => cell.key === key)
  const scans = figureOf(byKey('scans'))
  const averageCell = byKey('average')
  const { avgRating } = measures.kpis
  const tooFew =
    avgRating.value === null &&
    avgRating.evidence.availabilityReason === BELOW_MINIMUM_SAMPLE
  const average: MeasureFigure = tooFew
    ? { text: TOO_FEW, unit: null, tone: 'withheld', reason: averageCell?.detail ?? null }
    : figureOf(averageCell)
  return {
    scans,
    ratings: figureOf(byKey('ratings')),
    average,
    googleOpens: figureOf(byKey('googleOpens')),
    notes: figureOf(byKey('notes')),
    summary: summaryOf(measures, scans, average, style),
  }
}

export type GroupFigures = Readonly<{
  measures: RowMeasures
  /** Portals in the group today: "3 portals". Not those whose readings sit under it. */
  memberCount: number
}>

/** The ruled strip above the table, for one Property's Portals. */
export type OverviewStrip = Readonly<{
  cells: readonly ResultsCell[]
  /** The days the figures cover, in the Property's own time zone. */
  caption: string
  /** "Last 30 days, Europe/Sofia time · an average needs 5 private ratings". */
  footer: string
}>

/** What the sort reads: each row's scans, or nothing where they are not ready. */
export type OverviewSortFigures = Readonly<{
  portal: (portalId: string) => number | null
  group: (groupId: string) => number | null
}>

export type OverviewResultsIndex = Readonly<{
  portal: (portalId: string) => RowMeasures | null
  group: (groupId: string) => GroupFigures | null
  ungrouped: (propertyId: string) => GroupFigures | null
  strip: (propertyId: string) => OverviewStrip | null
  sortFigures: OverviewSortFigures
}>

function stripOf(
  property: PortalResultsPropertyRow,
  thresholds: PortalResultsThresholds,
): OverviewStrip {
  const { localDays, timezone } = property
  return {
    cells: measureCells(
      {
        kpis: property.kpis,
        thresholds,
        timezone,
        localDays,
        funnel: property.engagementFunnel,
      },
      { compare: property.comparePeriod !== null },
    ),
    caption: windowCaption(localDays, timezone),
    footer: `${currentPeriodLabel(localDays)}, ${timezone} time · an average needs ${thresholds.averageMinSample} private ratings`,
  }
}

function keyed<T, R>(
  rows: readonly T[],
  key: (row: T) => string,
  value: (row: T) => R,
): ReadonlyMap<string, R> {
  return new Map(rows.map((row) => [key(row), value(row)] as const))
}

export function indexOverviewResults(
  overview: PortalResultsOverview,
): OverviewResultsIndex {
  const { thresholds } = overview
  const zoneOf = keyed(
    overview.properties,
    (row) => row.propertyId,
    (row) => row.timezone,
  )
  const frameFor = (propertyId: string): MeasureFrame => ({
    thresholds,
    timezone: zoneOf.get(propertyId) ?? 'UTC',
  })
  const portals = keyed(
    overview.portals,
    (row) => row.portalId,
    (row) => ({ row, measures: rowMeasures(row, frameFor(row.propertyId)) }),
  )
  const groups = keyed(
    overview.groups,
    (row) => row.groupId,
    (row) => ({
      row,
      figures: {
        measures: rowMeasures(row, frameFor(row.propertyId), 'short'),
        memberCount: row.memberPortalIds.length,
      },
    }),
  )
  const ungrouped = keyed(
    overview.ungrouped,
    (row) => row.propertyId,
    (row): GroupFigures => ({
      measures: rowMeasures(row, frameFor(row.propertyId), 'short'),
      memberCount: row.memberPortalIds.length,
    }),
  )
  const strips = keyed(
    overview.properties,
    (row) => row.propertyId,
    (row) => stripOf(row, thresholds),
  )
  return {
    portal: (portalId) => portals.get(portalId)?.measures ?? null,
    group: (groupId) => groups.get(groupId)?.figures ?? null,
    ungrouped: (propertyId) => ungrouped.get(propertyId) ?? null,
    strip: (propertyId) => strips.get(propertyId) ?? null,
    sortFigures: {
      portal: (portalId) => portals.get(portalId)?.row.kpis.scans.value ?? null,
      group: (groupId) => groups.get(groupId)?.row.kpis.scans.value ?? null,
    },
  }
}

type HeadCounts = Readonly<{ memberCount: number; matchedCount: number }>

/**
 * The count in a group head: the Portals in the group today as the read counted
 * them, else as the list did. The read and the list are fetched a moment apart,
 * so the count never falls below what the list says is shown.
 */
export function groupHeadCount(
  head: HeadCounts,
  readCount: number | null,
): Readonly<{ members: number; matched: number }> {
  return {
    members: Math.max(readCount ?? head.memberCount, head.matchedCount),
    matched: head.matchedCount,
  }
}

/** What the page knows about the results: not shown, on their way, failed, or here. */
export type PortalOverviewResultsState =
  | Readonly<{ status: 'off' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'ready'; index: OverviewResultsIndex }>

/** What one row's measure cells draw. */
export type MeasureSlot =
  | Readonly<{ kind: 'off' }>
  | Readonly<{ kind: 'loading' }>
  /** The read failed, or it does not name this row: no figure, and never a zero. */
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'figures'; measures: RowMeasures }>

export function measureSlot(
  state: PortalOverviewResultsState,
  pick: (index: OverviewResultsIndex) => RowMeasures | null,
): MeasureSlot {
  if (state.status === 'off') return { kind: 'off' }
  if (state.status === 'loading') return { kind: 'loading' }
  if (state.status === 'failed') return { kind: 'unavailable' }
  const measures = pick(state.index)
  return measures ? { kind: 'figures', measures } : { kind: 'unavailable' }
}

/** A group's (or the ungrouped row's) figures, and the Portals the read counts in it. */
export function groupSlot(
  state: PortalOverviewResultsState,
  pick: (index: OverviewResultsIndex) => GroupFigures | null,
): Readonly<{ slot: MeasureSlot; memberCount: number | null }> {
  return {
    slot: measureSlot(state, (index) => pick(index)?.measures ?? null),
    memberCount:
      state.status === 'ready' ? (pick(state.index)?.memberCount ?? null) : null,
  }
}

/** The Property has more Portals than one read answers for. Retrying cannot help,
 *  so the page shows its list without results rather than a "Try again". */
function isTooManyPortals(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'too_many_portals'
  )
}

/**
 * What the route knows about the read, as the page's state. The read needs
 * `dashboard.read`, a different capability from the `portal.read` that got the
 * reader to the list: a role without it, or a beta-dark posture, gets the list
 * without results, and only a real failure says so.
 */
export function resultsStateOf(
  facts: Readonly<{ allowed: boolean; error: unknown }>,
  index: OverviewResultsIndex | null,
): PortalOverviewResultsState {
  if (!facts.allowed) return { status: 'off' }
  if (index) return { status: 'ready', index }
  if (facts.error === null) return { status: 'loading' }
  return isDarkCapabilityDenial(facts.error) || isTooManyPortals(facts.error)
    ? { status: 'off' }
    : { status: 'failed' }
}
