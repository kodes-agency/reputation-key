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
/** A tick every 4 weeks up to half a year, every 8 up to a year, every 16 beyond (doubled on a phone). */
const TICK_WEEKS = 4
const HALF_YEAR_DAYS = 182
const YEAR_DAYS = 365
/** The chart looks at least 8 weeks ahead, and a week past where both bands meet the goal. */
const MIN_AHEAD_DAYS = 56
/** Room below the lowest point and above the goal's line, in thousandths. */
const MARGIN_BELOW = 15
const MARGIN_ABOVE = 40
/** Room above the highest point drawn (today's dot and its words), when that is above the goal's line. */
const MARGIN_ABOVE_POINT = 20
const STEP = 10
/** Half a tick's words, as a share of the chart's width: on a desktop and on a phone. */
const TICK_EDGE = 0.03
const PHONE_TICK_EDGE = 0.1
/** "Today 4.02" sits left of today's dot: about this share of the chart's width and height. */
const TODAY_WORDS_WIDTH = 0.1
const TODAY_WORDS_HEIGHT = 0.12

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
  /**
   * Where the band's words sit: just above the goal's line, between where its
   * two edges reach it. No band point rises above the goal's line, so the words
   * never cover the band.
   */
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

/**
 * Ticks on whole multiples of the step from today, inside the domain and far
 * enough from its ends that their words are not cut off: a share of the span
 * (half a tick's words, wider on a phone).
 */
function ticksOf(
  [from, to]: readonly [number, number],
  stepWeeks: number,
  edgeShare: number,
): number[] {
  const step = stepWeeks * WEEK
  const edge = (to - from) * edgeShare
  const first = Math.ceil((from + edge) / step)
  const last = Math.floor((to - edge) / step)
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, i) => (first + i) * step,
  )
}

/** The tick step in weeks for a span of days: 4, 8 past half a year, 16 past a year. */
function tickWeeksOf([from, to]: readonly [number, number]): number {
  const span = to - from
  if (span > YEAR_DAYS) return 4 * TICK_WEEKS
  return span > HALF_YEAR_DAYS ? 2 * TICK_WEEKS : TICK_WEEKS
}

/**
 * From below the lowest point to above the goal's line, or above the highest
 * point drawn when the exact average is past the goal's line (Google lagging
 * on the goal, a goal found reached, one review moving a small Property's
 * average): the axis clips what is outside, so nothing drawn may be.
 */
function yDomainOf(chart: RatingGoalChartView, cap: number): readonly [number, number] {
  const drawn = [
    ...(chart.history ?? []).map((point) => point.thousandths),
    ...(chart.today === null ? [] : [chart.today]),
  ]
  const bands = [...chart.plan, ...chart.likely]
  const lowest =
    Math.min(cap, ...drawn, ...bands.map((point) => point.low)) - MARGIN_BELOW
  const highest = Math.max(
    cap + MARGIN_ABOVE,
    ...[...drawn, ...bands.map((point) => point.high)].map(
      (value) => value + MARGIN_ABOVE_POINT,
    ),
  )
  return [Math.floor(lowest / STEP) * STEP, Math.ceil(highest / STEP) * STEP]
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

/**
 * Whether a dot's words would sit under today's ("Today 4.02", left of today's
 * dot): a move in the last tenth of the span, near today's height.
 */
function underTodayWords(
  dot: ChartDot,
  today: number | null,
  [from, to]: readonly [number, number],
  [low, high]: readonly [number, number],
): boolean {
  if (today === null) return false
  return (
    dot.day >= -(to - from) * TODAY_WORDS_WIDTH &&
    Math.abs(dot.thousandths - today) <= (high - low) * TODAY_WORDS_HEIGHT
  )
}

/** On the goal's line, between where the band's fast and slow edges reach it. */
function bandAtOf(chart: RatingGoalChartView, cap: number): ClimbChartModel['bandAt'] {
  const fast = chart.likely.find((point) => point.high >= cap)?.day
  if (fast === undefined) return null
  const slow = chart.likely.find((point) => point.low >= cap)?.day ?? fast
  return { day: Math.round((fast + slow) / 2), thousandths: cap }
}

/** "4.1 likely in 9 weeks to 4 months": the header's own likely words; none once the goal is no longer active. */
function bandLabelOf(detail: RatingGoalDetailView): string | null {
  if (
    detail.state !== 'active' ||
    detail.forecast?.kind !== 'days' ||
    detail.chart?.likely.length === 0
  ) {
    return null
  }
  return `${tenthsText(detail.targetTenths)} likely in ${likelyText(detail.forecast)}`
}

/** What the chart shows, then the band in a sentence (the chart's text alternative). */
function captionOf(detail: RatingGoalDetailView, chart: RatingGoalChartView): string {
  const went =
    chart.history === null || chart.today === null
      ? 'Your review cache is still filling, so Google’s exact average is not drawn yet.'
      : `Google’s exact average went from ${twoDecimals(Math.round(detail.baseline.exactAverage * 1000))} when you set the goal to ${twoDecimals(chart.today)} today.`
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
  const step = tickWeeksOf(xDomain)
  const { anchor } = chart
  return {
    chart,
    xDomain,
    yDomain,
    ticks: ticksOf(xDomain, step, TICK_EDGE),
    phoneTicks: ticksOf(xDomain, 2 * step, PHONE_TICK_EDGE),
    lines: linesOf(chart, detail.targetTenths, yDomain),
    dots: dotsOf(chart)
      .filter((dot) => dot.day >= xDomain[0])
      .map((dot) =>
        underTodayWords(dot, chart.today, xDomain, yDomain)
          ? { ...dot, label: null }
          : dot,
      ),
    anchorLabel: `${anchor.kind === 'set' ? 'Plan set' : 'Plan changed'} · ${paceText(anchor.paceTenthsPerWeek)} at ${tenthsText(anchor.qualityTenths)}★`,
    anchorShortLabel: anchor.kind === 'set' ? 'Plan set' : 'Plan changed',
    todayLabel: chart.today === null ? 'Today' : `Today ${twoDecimals(chart.today)}`,
    bandLabel: bandLabelOf(detail),
    bandAt: bandAtOf(chart, goalLine),
    caption: captionOf(detail, chart),
  }
}
