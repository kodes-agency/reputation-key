// The line to the goal's arithmetic (pure; 2026-11-01): the days along the bottom and
// the stars up the side as shares of the plot, the paths, and the months under them.
// `rating-goal-line-chart-view.ts` says what is drawn; this says where.
import type {
  RatingGoalChartPoint,
  RatingGoalChartView,
  RatingGoalDetailView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { formatLocalDate } from '#/lib/format'

const DAY_MS = 86_400_000
/** Room above the goal's line for its words, and under the lowest line. */
const TOP_ROOM = 0.14
const BOTTOM_ROOM = 0.07
/**
 * The way left fits whole up to this share of the past; else it runs off the edge. A
 * goal set in the last two weeks has little past to show and the whole climb ahead,
 * so it gets far more room for it.
 */
const WHOLE_WAY_SHARE = 1.2
const CUT_WAY_SHARE = 0.42
const YOUNG_GOAL_DAYS = 14
const YOUNG_WHOLE_WAY_SHARE = 3
const YOUNG_CUT_WAY_SHARE = 1
const END_ROOM_SHARE = 0.04
const MIN_END_DAYS = 3
/** A property with almost no history still gets a chart of some length. */
const MIN_PAST_DAYS = 14
const MONTHS_ALL_NAMED = 8

const round = (value: number): number => Math.round(value * 100) / 100

export function shiftKey(key: string, days: number): string {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export const dayText = (todayKey: string, day: number): string =>
  formatLocalDate(shiftKey(todayKey, day), { year: false }) ?? ''

/**
 * What Google showed on a day. From the set: the number it started at, then each move
 * up to that day. Before the set the read keeps no moves, so the exact line says what
 * Google's rounding made of it (a partial cache has no line: the number at the set).
 */
export function shownOn(
  detail: RatingGoalDetailView,
  chart: RatingGoalChartView,
  day: number,
  value?: number,
): number {
  const start = Math.round(detail.baseline.googleShows * 10)
  if (value !== undefined && day < chart.setDay && chart.history !== null) {
    return (
      chart.thresholds.filter((line) => line.thousandths <= value).at(-1)?.tenths ?? start
    )
  }
  return chart.shownChanges
    .filter((move) => move.day <= day)
    .reduce((_, move) => move.tenths, start)
}

/** Google's own numbers as steps, on the lines where it shows them: the partial cache's line. */
export function stepPoints(
  detail: RatingGoalDetailView,
  chart: RatingGoalChartView,
): readonly RatingGoalChartPoint[] {
  const level = (tenths: number): number =>
    chart.thresholds.find((line) => line.tenths === tenths)?.thousandths ??
    tenths * 100 - 50
  const start = Math.round(detail.baseline.googleShows * 10)
  const points: RatingGoalChartPoint[] = [
    { day: chart.firstDay, thousandths: level(start) },
  ]
  let held = start
  for (const move of chart.shownChanges) {
    points.push(
      { day: move.day, thousandths: level(held) },
      { day: move.day, thousandths: level(move.tenths) },
    )
    held = move.tenths
  }
  const shows = detail.google?.shows
  const today = shows === null || shows === undefined ? held : Math.round(shows * 10)
  return [...points, { day: 0, thousandths: level(today) }]
}

export function valueOn(points: readonly RatingGoalChartPoint[], day: number): number {
  const first = points[0]
  if (first === undefined) return 0
  let earlier = first
  for (const point of points) {
    if (point.day > day) {
      const span = point.day - earlier.day
      if (span <= 0) return point.thousandths
      return (
        earlier.thousandths +
        ((point.thousandths - earlier.thousandths) * (day - earlier.day)) / span
      )
    }
    earlier = point
  }
  return earlier.thousandths
}

export type Scale = Readonly<{
  x: (day: number) => number
  y: (thousandths: number) => number
  end: number
  first: number
}>

/**
 * When the goal arrives, in days from today: only where the page's words give a time,
 * so the chart never promises what the sentence above it does not.
 */
export function arrivalDay(detail: RatingGoalDetailView): number | null {
  const forecast = detail.forecast
  if (detail.state !== 'active' || detail.googleShowsSoon) return null
  if (detail.status === 'reviews_too_low' || detail.status === 'waiting_for_google') {
    return null
  }
  if (forecast?.kind !== 'days') return null
  return forecast.central.num / forecast.central.den
}

export function scaleOf(
  points: readonly RatingGoalChartPoint[],
  chart: RatingGoalChartView,
  goalLine: number,
  arrival: number | null,
  lowLine: number,
): Scale {
  const first = points[0]?.day ?? chart.firstDay
  const past = Math.max(MIN_PAST_DAYS, -first)
  const room = Math.max(MIN_END_DAYS, past * END_ROOM_SHARE)
  const young = -chart.setDay < YOUNG_GOAL_DAYS
  const whole = young ? YOUNG_WHOLE_WAY_SHARE : WHOLE_WAY_SHARE
  const cut = young ? YOUNG_CUT_WAY_SHARE : CUT_WAY_SHARE
  const end =
    arrival === null ? room : arrival + room <= past * whole ? arrival + room : past * cut
  const values = points.map((point) => point.thousandths)
  const top = Math.max(goalLine, ...values)
  const bottom = Math.min(lowLine, ...values)
  const span = Math.max(1, top - bottom)
  const yMax = top + span * TOP_ROOM
  const yMin = bottom - span * BOTTOM_ROOM
  return {
    first,
    end,
    x: (day) => round(((day - first) / (end - first)) * 100),
    y: (value) => round((1 - (value - yMin) / (yMax - yMin)) * 100),
  }
}

export const pathOf = (
  points: readonly RatingGoalChartPoint[],
  { x, y }: Scale,
): string =>
  points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(point.day)} ${y(point.thousandths)}`,
    )
    .join('')

/** Each first of a month inside the chart, named; past eight of them, every other one. */
export function monthsOf(
  todayKey: string,
  { x, first, end }: Scale,
): readonly Readonly<{ x: number; label: string }>[] {
  const start = shiftKey(todayKey, first)
  const [year = 0, month = 1] = start.split('-').map(Number)
  const today = Date.parse(`${todayKey}T00:00:00.000Z`)
  const days: { day: number; label: string }[] = []
  for (let index = 1; index < 60; index += 1) {
    const at = Date.UTC(year, month - 1 + index, 1)
    const day = Math.round((at - today) / DAY_MS)
    if (day > end) break
    const label = formatLocalDate(new Date(at).toISOString().slice(0, 10), {
      year: false,
    })
    days.push({ day, label: (label ?? '').split(' ')[0] ?? '' })
  }
  const step = days.length > MONTHS_ALL_NAMED ? 2 : 1
  return days
    .filter((_, index) => index % step === 0)
    .map(({ day, label }) => ({ x: x(day), label }))
}
