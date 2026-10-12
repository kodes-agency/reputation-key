// The strip above the Portals table: a Property's, a group's, or the Organization's
// total, in the words of the shared cell builder. Pure.
import type {
  PortalResultsMeasures,
  PortalResultsOverview,
  PortalResultsPropertyRow,
  PortalResultsThresholds,
} from '#/contexts/reporting/application/public-api'
import { measureCells, type ResultsCell } from '../portal-analytics/portal-results-cells'
import {
  currentPeriodLabel,
  windowCaption,
  zoneTimeLabel,
} from '../portal-analytics/portal-results-window'

/** The ruled strip above the table, for one Property's Portals or for the Organization's. */
export type OverviewStrip = Readonly<{
  cells: readonly ResultsCell[]
  /**
   * The days the figures cover, in the Property's own time zone. Null for the
   * Organization: each Property reads its own days, so there is no one range.
   */
  caption: string | null
  /** "Last 30 days, Sofia time · an average needs 5 private ratings". */
  footer: string
  /** The private ratings an average needs before it is shown. */
  averageMinSample: number
}>

/** The strip of `measures` (a Property's, or one group's) in the window of `property`. */
export function stripOf(
  property: PortalResultsPropertyRow,
  measures: PortalResultsMeasures,
  thresholds: PortalResultsThresholds,
): OverviewStrip {
  const { localDays, timezone } = property
  return {
    cells: measureCells(
      {
        kpis: measures.kpis,
        thresholds,
        timezone,
        localDays,
        funnel: measures.engagementFunnel,
      },
      { compare: property.comparePeriod !== null },
    ),
    caption: windowCaption(localDays, timezone),
    footer: `${currentPeriodLabel(localDays)}, ${zoneTimeLabel(timezone)} · an average needs ${thresholds.averageMinSample} private ratings`,
    averageMinSample: thresholds.averageMinSample,
  }
}

/**
 * The total's strip. The total carries no window of its own: each Property is
 * read through its own days, in its own zone. The days only name the window's
 * length ("the 30 days before"), which is the same for every Property.
 */
export function totalStripOf(
  overview: PortalResultsOverview,
  thresholds: PortalResultsThresholds,
): OverviewStrip {
  const { properties } = overview
  const days = properties[0]?.localDays ?? null
  const zones = new Set(properties.map((row) => row.timezone))
  const [onlyZone] = zones
  const floor = `an average needs ${thresholds.averageMinSample} private ratings`
  return {
    cells: measureCells(
      {
        kpis: overview.total.kpis,
        thresholds,
        // One shared zone says what its own readings say; mixed zones name none.
        timezone: zones.size === 1 && onlyZone ? onlyZone : null,
        localDays: days,
        funnel: overview.total.engagementFunnel,
      },
      {
        compare:
          properties.length > 0 && properties.every((row) => row.comparePeriod !== null),
      },
    ),
    caption: null,
    averageMinSample: thresholds.averageMinSample,
    footer: days
      ? `${currentPeriodLabel(days)} · each property’s local time · ${floor}`
      : `Each property’s local time · ${floor}`,
  }
}
