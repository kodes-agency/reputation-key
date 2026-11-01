// "Your rating on Google" on the Google rating goal's page, worked out (pure,
// 2026-11-01, ADR 0067): the chart every manager already knows from a weight or a
// savings app. The exact average so far, quiet before the goal was set; the goal as
// one straight line; one dotted line for the way left; real months under it; and
// the tenths Google shows up the side. Each tenth's line sits at the average at
// which Google shows it, so crossing "4.0" is Google showing 4.0 and no one reads a
// rounded threshold. Every place is a share of the plot, 0 to 100, so the chart
// fills its width with no measuring and nothing moves when it draws. While RepKey
// lacks some of Google's reviews there is no exact line, and it steps through
// Google's own numbers instead.
import type {
  RatingGoalChartPoint,
  RatingGoalChartView,
  RatingGoalDetailView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { shortArrival } from './rating-goal-arrival-words'
import {
  arrivalDay,
  dayText,
  monthsOf,
  pathOf,
  scaleOf,
  shownOn,
  stepPoints,
  valueOn,
  type Scale,
} from './rating-goal-line-chart-scale'
import { tenthsText } from './rating-goal-view'

/** Past this many tenths, every other one is named. */
const TICKS_ALL_NAMED = 6
/** Today's words need this much of the plot's height under the goal's line. */
const TODAY_WORDS_ROOM = 11
/** Words to the left of a point this near the chart's left edge would leave the plot. */
const LEFT_EDGE = 20
/** Where a point is chosen is never narrower, even with today alone on the line. */
const MIN_CHOOSING_WIDTH = 20
/** A move's words give way to today's this close to them. */
const WORDS_APART = 25
/** This near the chart's floor, the set's words go above its point, clear of the months. */
const NEAR_FLOOR = 80

export type LineChartPlace = Readonly<{ x: number; y: number }>
export type LineChartWords = LineChartPlace &
  Readonly<{ words: string; above: boolean; side: 'left' | 'right' }>

export type LineChartModel = Readonly<{
  /** The caption's sentence, and the picture's name for a screen reader. */
  sentence: string
  /** SVG paths in a 100 by 100 box. */
  before: string | null
  since: string
  wash: string | null
  ahead: string | null
  goalY: number
  goalLabel: string
  grid: readonly Readonly<{ y: number; label: string | null }>[]
  months: readonly Readonly<{ x: number; label: string }>[]
  today: LineChartWords
  /** The day the goal was set: its dot, and its words unless a move's are in their place. */
  set: (LineChartWords & Readonly<{ named: boolean }>) | null
  moves: readonly (LineChartPlace &
    Readonly<{ key: string; up: boolean; words: LineChartWords | null }>)[]
  /** The way left ends here on the goal's line when it fits the chart. */
  arrival: LineChartPlace | null
  /** Above the goal's line, at its right end. */
  aheadWords: string | null
  /** How far across the line runs: where the pointer and the keys choose a point. */
  pastWidth: number
  stops: readonly (LineChartPlace & Readonly<{ key: number; line: string }>)[]
}>

/**
 * Today's words: above the point when there is room under the goal's line or the
 * point is past it, else under it.
 */
function todayWords(
  place: LineChartPlace,
  words: string,
  goalY: number,
  rising: boolean,
): LineChartWords {
  const past = place.y <= goalY
  const above = past || (rising && place.y - goalY >= TODAY_WORDS_ROOM)
  // Under the point the climbing line runs to its left, so the words go right of it;
  // and they always do at the chart's left edge, where there is no room for them.
  const side =
    place.x < LEFT_EDGE || (!above && rising && place.x < 75) ? 'right' : 'left'
  return { ...place, words, above, side }
}

function sentenceOf(detail: RatingGoalDetailView, chart: RatingGoalChartView): string {
  const shows = detail.google?.shows
  const start = tenthsText(Math.round(detail.baseline.googleShows * 10))
  const now =
    shows === null || shows === undefined ? null : tenthsText(Math.round(shows * 10))
  const stale = detail.google?.current === false
  const went =
    now === null
      ? `Google showed ${start} when you set the goal.`
      : stale
        ? `Google showed ${start} when you set the goal and ${now} when we last read it.`
        : `Google showed ${start} when you set the goal and shows ${now} today.`
  const lacking =
    chart.history === null
      ? ' RepKey doesn’t hold every review yet, so this follows Google’s own number.'
      : ''
  const arrival = arrivalDay(detail) === null ? null : shortArrival(detail)
  return `${went}${lacking}${arrival === null ? '' : ` ${arrival}.`}`
}

function movesOf(
  chart: RatingGoalChartView,
  points: readonly RatingGoalChartPoint[],
  scale: Scale,
  today: LineChartWords,
): LineChartModel['moves'] {
  return chart.shownChanges.map((move, index) => {
    const place = { x: scale.x(move.day), y: scale.y(valueOn(points, move.day)) }
    const latest = index === chart.shownChanges.length - 1
    const said = move.up ? 'Google showed' : 'Back to'
    // Above the line, where it has just climbed from; today's words come first there.
    const clear = !today.above || Math.abs(today.x - place.x) >= WORDS_APART
    return {
      key: `${move.day}-${move.tenths}`,
      up: move.up,
      ...place,
      words:
        latest && clear
          ? {
              ...place,
              words: `${said} ${tenthsText(move.tenths)}, ${dayText(chart.todayKey, move.day)}`,
              above: true,
              side: place.x < 30 ? 'right' : 'left',
            }
          : null,
    }
  })
}

/** The tenths' lines: from the one under the lowest point, up to the goal or past it. */
function linesOf(
  chart: RatingGoalChartView,
  points: readonly RatingGoalChartPoint[],
  goalLine: number,
) {
  const values = points.map((point) => point.thousandths)
  const lowest = Math.min(...values)
  const highest = Math.max(goalLine, ...values)
  const below = chart.thresholds.filter((line) => line.thousandths <= lowest).at(-1)
  const floor = below?.thousandths ?? lowest
  return {
    floor,
    lines: chart.thresholds.filter(
      (line) => line.thousandths >= floor && line.thousandths <= highest,
    ),
  }
}

/** The goal's own line, from the read's lines, or its threshold when they stop short of it. */
const goalLineOf = (detail: RatingGoalDetailView, chart: RatingGoalChartView): number =>
  chart.thresholds.find((line) => line.tenths === detail.targetTenths)?.thousandths ??
  Math.round(detail.threshold * 1000)

/** "Today 4.0", "Last 4.0" for stale numbers, or "Today" before Google has sent one. */
function todayText(detail: RatingGoalDetailView): string {
  const shows = detail.google?.shows
  const when = detail.google?.current === false ? 'Last' : 'Today'
  return shows === null || shows === undefined
    ? when
    : `${when} ${tenthsText(Math.round(shows * 10))}`
}

/** The way left: one dotted line to the goal, cut at the chart's edge when the goal is far. */
function aheadOf(
  detail: RatingGoalDetailView,
  scale: Scale,
  from: LineChartPlace,
  fromValue: number,
  goalLine: number,
): Pick<LineChartModel, 'ahead' | 'arrival' | 'aheadWords'> {
  const arrival = arrivalDay(detail)
  if (arrival === null || arrival <= 0) {
    return { ahead: null, arrival: null, aheadWords: null }
  }
  const stop = Math.min(arrival, scale.end)
  const value = fromValue + ((goalLine - fromValue) * stop) / arrival
  const whole = arrival <= scale.end
  const words = shortArrival(detail)
  return {
    ahead: `M${from.x} ${from.y}L${scale.x(stop)} ${scale.y(value)}`,
    arrival: whole ? { x: scale.x(arrival), y: scale.y(goalLine) } : null,
    aheadWords: words === null ? null : whole ? words : `${words} →`,
  }
}

/** The line split at the day the goal was set: quiet before it, the climb after. */
function splitAtSet(
  points: readonly RatingGoalChartPoint[],
  chart: RatingGoalChartView,
  scale: Scale,
): Pick<LineChartModel, 'before' | 'since' | 'wash'> &
  Readonly<{ shown: boolean; place: LineChartPlace }> {
  const firstDay = points[0]?.day ?? chart.firstDay
  const shown = chart.setDay > firstDay
  const setAt = shown ? chart.setDay : firstDay
  const setPoint = { day: setAt, thousandths: valueOn(points, setAt) }
  const beforeSet = points.filter((point) => point.day < setAt)
  const since = [setPoint, ...points.filter((point) => point.day > setAt)]
  const place = { x: scale.x(setAt), y: scale.y(setPoint.thousandths) }
  const last = points.at(-1)
  return {
    shown,
    place,
    before:
      beforeSet.length === 0 || !shown ? null : pathOf([...beforeSet, setPoint], scale),
    since: pathOf(since, scale),
    wash:
      since.length < 2 || last === undefined
        ? null
        : `${pathOf(since, scale)}L${scale.x(last.day)} 100L${place.x} 100Z`,
  }
}

/**
 * Each point a pointer can choose, read out once. A step is two points on one day:
 * the later of them is what Google showed from that day.
 */
function stopsOf(
  detail: RatingGoalDetailView,
  chart: RatingGoalChartView,
  points: readonly RatingGoalChartPoint[],
  scale: Scale,
): LineChartModel['stops'] {
  const byDay = new Map(points.map((point) => [point.day, point]))
  return [...byDay.values()].map((point) => {
    const shown = tenthsText(shownOn(detail, chart, point.day, point.thousandths))
    const today = point.day === 0 && detail.google?.current !== false
    return {
      key: point.day,
      x: scale.x(point.day),
      y: scale.y(point.thousandths),
      line: today
        ? `Today · Google shows ${shown}`
        : `${point.day === 0 ? 'Today' : dayText(chart.todayKey, point.day)} · Google showed ${shown}`,
    }
  })
}

/** Null for a goal to keep a number: it has no climb to draw. */
export function lineChartModel(detail: RatingGoalDetailView): LineChartModel | null {
  const chart = detail.chart
  if (chart === null) return null
  const points = chart.history ?? stepPoints(detail, chart)
  const last = points.at(-1)
  if (last === undefined) return null
  const goalLine = goalLineOf(detail, chart)
  const { floor, lines } = linesOf(chart, points, goalLine)
  const scale = scaleOf(points, chart, goalLine, arrivalDay(detail), floor)
  const goalY = scale.y(goalLine)
  const namedEvery = lines.length > TICKS_ALL_NAMED ? 2 : 1
  const prior = points.at(-2)
  const rising = prior === undefined || last.thousandths >= prior.thousandths
  const todayPlace = { x: scale.x(last.day), y: scale.y(last.thousandths) }
  const today = todayWords(todayPlace, todayText(detail), goalY, rising)
  const moves = movesOf(chart, points, scale, today)
  const { shown: setShown, place: setPlace, ...line } = splitAtSet(points, chart, scale)
  const setAbove = setPlace.y > NEAR_FLOOR
  // A named move right after the set, or today's words beside it, say the more useful
  // thing: the set keeps its dot.
  const setCrowded =
    moves.some(
      (move) => move.words !== null && Math.abs(move.x - setPlace.x) < WORDS_APART,
    ) ||
    (setAbove === today.above && Math.abs(today.x - setPlace.x) < WORDS_APART)
  return {
    sentence: sentenceOf(detail, chart),
    ...line,
    ...aheadOf(detail, scale, todayPlace, last.thousandths, goalLine),
    goalY,
    goalLabel: tenthsText(detail.targetTenths),
    grid: lines
      .filter((tenth) => tenth.tenths !== detail.targetTenths)
      .map((tenth, index) => ({
        y: scale.y(tenth.thousandths),
        label: index % namedEvery === 0 ? tenthsText(tenth.tenths) : null,
      })),
    months: monthsOf(chart.todayKey, scale),
    today,
    set: setShown
      ? {
          ...setPlace,
          words: `Goal set, ${dayText(chart.todayKey, chart.setDay)}`,
          above: setAbove,
          side: setPlace.x < 70 ? 'right' : 'left',
          named: !setCrowded,
        }
      : null,
    moves,
    pastWidth: Math.max(todayPlace.x, MIN_CHOOSING_WIDTH),
    stops: stopsOf(detail, chart, points, scale),
  }
}
