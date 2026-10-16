// "The climb, step by step" (round 5, PLAN-D D-2, mock D3), worked out for the
// lazy chart (pure): its axes, the words on each line and marker, and the one
// sentence that is the chart's caption and accessible description. The read
// sends every point as whole days from today and thousandths of a star; this
// only frames them. Time runs in weeks from today ("8 weeks ago", "Today", "In 8
// weeks"), never a calendar date: an arrival is a duration (R4-3).
import type {
  RatingGoalBandPoint,
  RatingGoalChartView,
  RatingGoalDetailView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatNumber } from '#/lib/format'
import { paceText } from './rating-goal-pace-words'
import { likelyText } from './rating-goal-setup-time'
import { tenthsText } from './rating-goal-view'

const WEEK = 7
/** A tick every 4 weeks, every 8 over a span longer than half a year (and on a phone). */
const TICK_WEEKS = 4
const HALF_YEAR_DAYS = 182
/** The chart looks at least 8 weeks ahead, and a week past where both bands meet the goal. */
const MIN_AHEAD_DAYS = 56
/** Room below the lowest point and above the goal's line, in thousandths. */
const MARGIN_BELOW = 15
const MARGIN_ABOVE = 40
const STEP = 10

export type ChartLine = Readonly<{
  thousandths: number
  label: string
  /** On a phone: "Goal 4.1", "4.0". */
  shortLabel: string
  goal: boolean
}>
export type ChartDot = Readonly<{
  day: number
  thousandths: number
  up: boolean
  label: string | null
}>

export type ClimbChartModel = Readonly<{
  chart: RatingGoalChartView
  xDomain: readonly [number, number]
  yDomain: readonly [number, number]
  ticks: readonly number[]
  phoneTicks: readonly number[]
  lines: readonly ChartLine[]
  dots: readonly ChartDot[]
  anchorLabel: string
  /** On a phone: "Plan set". */
  anchorShortLabel: string
  todayLabel: string
  bandLabel: string | null
  /** Where the band's words sit: on the goal's line, between its two ends. */
  bandAt: Readonly<{ day: number; thousandths: number }> | null
  caption: string
}>

const twoDecimals = (thousandths: number): string =>
  formatNumber(thousandths / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "8 weeks ago", "Today", "In 4 weeks". */
export function dayTickLabel(day: number): string {
  if (day === 0) return 'Today'
  const weeks = Math.round(Math.abs(day) / WEEK)
  const span = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
  return day < 0 ? `${span} ago` : `In ${span}`
}

/** The first day a band sits on the goal's line at both edges; null when it never does. */
function meetsGoal(points: readonly RatingGoalBandPoint[], cap: number): number | null {
  return points.find((point) => point.low >= cap && point.high >= cap)?.day ?? null
}

function xDomainOf(chart: RatingGoalChartView, cap: number): readonly [number, number] {
  const ends = [chart.likely, chart.plan].map((points) => {
    const met = meetsGoal(points, cap)
    return met === null ? (points.at(-1)?.day ?? 0) : met + WEEK
  })
  return [chart.firstDay, Math.max(MIN_AHEAD_DAYS, ...ends)]
}

/** Ticks on whole multiples of the step from today, inside the domain. */
function ticksOf([from, to]: readonly [number, number], stepWeeks: number): number[] {
  const step = stepWeeks * WEEK
  const first = Math.ceil(from / step)
  const last = Math.floor(to / step)
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, i) => (first + i) * step,
  )
}

function yDomainOf(chart: RatingGoalChartView, cap: number): readonly [number, number] {
  const values = [
    ...(chart.history ?? []).map((point) => point.thousandths),
    ...[...chart.plan, ...chart.likely].map((point) => point.low),
    chart.today ?? cap,
  ]
  const lowest = Math.min(...values) - MARGIN_BELOW
  return [Math.floor(lowest / STEP) * STEP, Math.ceil((cap + MARGIN_ABOVE) / STEP) * STEP]
}

function linesOf(
  chart: RatingGoalChartView,
  targetTenths: number,
  [low, high]: readonly [number, number],
): ChartLine[] {
  return chart.thresholds
    .filter((line) => line.thousandths >= low && line.thousandths <= high)
    .map((line) => ({
      thousandths: line.thousandths,
      goal: line.tenths === targetTenths,
      shortLabel:
        line.tenths === targetTenths
          ? `Goal ${tenthsText(line.tenths)}`
          : tenthsText(line.tenths),
      label:
        line.tenths === targetTenths
          ? `Your goal: Google shows ${tenthsText(line.tenths)} above this line`
          : `Google shows ${tenthsText(line.tenths)} above this line`,
    }))
}

/** Google's moves, on the line it crossed; only the latest is named. */
function dotsOf(chart: RatingGoalChartView): ChartDot[] {
  const at = (tenths: number) => chart.thresholds.find((line) => line.tenths === tenths)
  return chart.shownChanges.flatMap((move, index) => {
    const line = at(move.up ? move.tenths : move.tenths + 1)
    if (line === undefined) return []
    const latest = index === chart.shownChanges.length - 1
    const words = move.up
      ? `Google shows ${tenthsText(move.tenths)}`
      : `Back to ${tenthsText(move.tenths)}`
    return [
      {
        day: move.day,
        thousandths: line.thousandths,
        up: move.up,
        label: latest ? words : null,
      },
    ]
  })
}

/** On the goal's line, between where the band's fast and slow edges reach it. */
function bandAtOf(chart: RatingGoalChartView, cap: number): ClimbChartModel['bandAt'] {
  const fast = chart.likely.find((point) => point.high >= cap)?.day
  if (fast === undefined) return null
  const slow = chart.likely.find((point) => point.low >= cap)?.day ?? fast
  return { day: Math.round((fast + slow) / 2), thousandths: cap }
}

/** "4.1 likely in 9 weeks to 4 months": the header's own likely words. */
function bandLabelOf(detail: RatingGoalDetailView): string | null {
  if (detail.forecast?.kind !== 'days' || detail.chart?.likely.length === 0) return null
  return `${tenthsText(detail.targetTenths)} likely in ${likelyText(detail.forecast)}`
}

function captionOf(detail: RatingGoalDetailView, chart: RatingGoalChartView): string {
  if (chart.history === null || chart.today === null) {
    return 'Your review cache is still filling, so the line starts today.'
  }
  const went = `Google’s exact average went from ${twoDecimals(Math.round(detail.baseline.exactAverage * 1000))} when you set the goal to ${twoDecimals(chart.today)} today.`
  const band = bandLabelOf(detail)
  return band === null
    ? went
    : `${went} ${band.replace(' likely in ', ' is likely in ')}.`
}

/** The chart of an active or just-finished climb; null for a goal to keep a number. */
export function climbChartModel(detail: RatingGoalDetailView): ClimbChartModel | null {
  const chart = detail.chart
  if (chart === null) return null
  const goalLine =
    chart.thresholds.find((line) => line.tenths === detail.targetTenths)?.thousandths ??
    Math.round(detail.threshold * 1000)
  const xDomain = xDomainOf(chart, goalLine)
  const yDomain = yDomainOf(chart, goalLine)
  const step = xDomain[1] - xDomain[0] > HALF_YEAR_DAYS ? 2 * TICK_WEEKS : TICK_WEEKS
  const { anchor } = chart
  return {
    chart,
    xDomain,
    yDomain,
    ticks: ticksOf(xDomain, step),
    phoneTicks: ticksOf(xDomain, 2 * step),
    lines: linesOf(chart, detail.targetTenths, yDomain),
    dots: dotsOf(chart).filter((dot) => dot.day >= xDomain[0]),
    anchorLabel: `${anchor.kind === 'set' ? 'Plan set' : 'Plan changed'} · ${paceText(anchor.paceTenthsPerWeek)} at ${tenthsText(anchor.qualityTenths)}★`,
    anchorShortLabel: anchor.kind === 'set' ? 'Plan set' : 'Plan changed',
    todayLabel: chart.today === null ? 'Today' : `Today ${twoDecimals(chart.today)}`,
    bandLabel: bandLabelOf(detail),
    bandAt: bandAtOf(chart, goalLine),
    caption: captionOf(detail, chart),
  }
}
