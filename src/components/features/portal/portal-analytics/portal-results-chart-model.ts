// Portal results — the weekly chart as plain numbers.
//
// The chart is HTML and one SVG line, not a charting library: every position is
// a percentage of its plot, so it needs no measuring, renders the same on the
// server and in the browser, and every bar and dot is a real element a test and
// a screen reader can reach. This module turns the server's series into those
// percentages. Two axes: qualified scans per week (bars, this period beside the
// period before) and the average private rating (a line, current period only).

import type {
  PortalResultsSeries,
  PortalVersionMarker,
} from '#/contexts/reporting/application/public-api'
import { formatDayRange } from './portal-results-window'

export type Scale = Readonly<{ ceiling: number; ticks: readonly number[] }>

const STEPS = [1, 2, 5] as const
const MAX_INTERVALS = 4

/** A round top for the axis: the smallest 1, 2 or 5 times a power of ten that needs at most four intervals. */
export function niceScale(max: number): Scale {
  if (max <= 0) return { ceiling: 4, ticks: [0, 1, 2, 3, 4] }
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const base of STEPS) {
      const step = base * magnitude
      const intervals = Math.ceil(max / step)
      if (intervals <= MAX_INTERVALS) {
        return {
          ceiling: step * intervals,
          ticks: Array.from({ length: intervals + 1 }, (_, index) => index * step),
        }
      }
    }
  }
}

export type AverageDomain = Readonly<{
  low: number
  high: number
  /** Whole stars, top first, for the axis labels. */
  ticks: readonly number[]
}>

const DEFAULT_LOW_STAR = 3
const TOP_STAR = 5

/** 3 to 5 stars, reaching down to the lowest whole star only when an average needs it. */
export function averageDomain(averages: readonly number[]): AverageDomain {
  const lowest =
    averages.length === 0 ? DEFAULT_LOW_STAR : Math.floor(Math.min(...averages))
  const low = Math.min(DEFAULT_LOW_STAR, Math.max(1, lowest))
  return {
    low,
    high: TOP_STAR,
    ticks: Array.from({ length: TOP_STAR - low + 1 }, (_, index) => TOP_STAR - index),
  }
}

export type ChartColumn = Readonly<{
  index: number
  label: string
  scans: number | null
  priorScans: number | null
  /** Bar heights, percent of the scan axis. Null when the figure is not known. */
  scansPercent: number | null
  priorScansPercent: number | null
  ratings: number | null
  average: number | null
  /** Distance of the average's dot from the top of its plot, percent. */
  averageFromTop: number | null
  /** Why a bucket with ratings has no average: "4 ratings, too few". Only for a bucket below the floor, never while ratings are not ready. */
  averageNote: string | null
}>

export type ChartMarker = Readonly<{
  key: string
  label: string
  /** Distance from the left of the plot, percent: the middle of its day. */
  leftPercent: number
  /** Write the label to the left of the line, so it stays inside the plot. */
  labelBeforeLine: boolean
}>

export type ChartModel = Readonly<{
  columns: readonly ChartColumn[]
  scans: Scale
  average: AverageDomain
  markers: readonly ChartMarker[]
  hasPrior: boolean
}>

const DAYS_PER_BUCKET = 7
/** Past this share of the plot a label written to the right of its line runs off the edge. */
const LABEL_FLIP_PERCENT = 60

function percentOf(value: number | null, ceiling: number): number | null {
  return value === null ? null : (value / ceiling) * 100
}

function ratingsNote(count: number): string {
  return `${count} ${count === 1 ? 'rating' : 'ratings'}, too few`
}

/** "v5 published 22 Sep": the chart's words, also listed under its values. */
export function markerLabel(marker: PortalVersionMarker): string {
  const day = formatDayRange(marker.localDate, marker.localDate)
  return marker.kind === 'rollback'
    ? `v${marker.version} made live again ${day}`
    : `v${marker.version} published ${day}`
}

export function chartModel(
  series: PortalResultsSeries,
  versionMarkers: readonly PortalVersionMarker[],
): ChartModel {
  const { weeks } = series
  const heights = weeks.flatMap((week) => [week.scans ?? 0, week.priorScans ?? 0])
  const scans = niceScale(Math.max(0, ...heights))
  const shown = weeks.flatMap((week) => (week.average === null ? [] : [week.average]))
  const average = averageDomain(shown)
  const span = average.high - average.low

  const columns = weeks.map((week): ChartColumn => ({
    index: week.index,
    label: formatDayRange(week.startLocalDate, week.endLocalDate),
    scans: week.scans,
    priorScans: week.priorScans,
    scansPercent: percentOf(week.scans, scans.ceiling),
    priorScansPercent: percentOf(week.priorScans, scans.ceiling),
    ratings: week.ratings,
    average: week.average,
    averageFromTop:
      week.average === null ? null : ((average.high - week.average) / span) * 100,
    averageNote:
      week.averageWithheld === 'below_floor' && (week.ratings ?? 0) > 0
        ? ratingsNote(week.ratings ?? 0)
        : null,
  }))
  const markers = versionMarkers.map((marker): ChartMarker => {
    // The last bucket can be shorter than a week: its days are wider.
    const bucketDays = weeks[marker.week]?.days ?? DAYS_PER_BUCKET
    const leftPercent =
      ((marker.week + (marker.dayInWeek + 0.5) / bucketDays) / weeks.length) * 100
    return {
      key: `v${marker.version}-${marker.localDate}`,
      label: markerLabel(marker),
      leftPercent,
      labelBeforeLine: leftPercent > LABEL_FLIP_PERCENT,
    }
  })
  return {
    columns,
    scans,
    average,
    markers,
    hasPrior: weeks.some((week) => week.priorScans !== null),
  }
}
