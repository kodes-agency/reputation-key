// Property Google rating goal — what the detail page draws (pure).
//
// Round 5 (2026-10-16, PLAN-D D-2): "The climb, step by step" (the exact
// average over time from Review's week-end averages, the plan's cone, the
// likely band, a line for each tenth and Google's own moves), "Your plan, so
// far" and the rows of "What moved you" that carry no per-review value. Days
// are whole Property-local days from today; star values thousandths, half up.
//
// The cone starts at the latest plan change (else the set): at the set from
// the stored baseline; at a change from the history at the Monday of the
// change's week, with the reviews counted since taken off Google's count (no
// interpolation, E15). The band is the card's own arrival (E16), so the chart
// and the header's sentence cannot disagree. A partial cache draws no history
// and no cone from a change: the line would be the cache's, not Google's.

import type {
  GoogleRatingHistory,
  GoogleShownNumber,
} from '#/contexts/review/application/public-api'
import {
  initialPlan,
  likelyBand,
  perMonthOf28Days,
  planCone,
  type ClimbStart,
} from '../domain/rating-goal-climb'
import {
  displayedTenths,
  ratio,
  thresholdThousandths,
  type Ratio,
} from '../domain/rating-goal-numbers'
import { PERFECT_TENTHS } from '../domain/rating-goal-stops'
import {
  chartStart,
  chartWeeks,
  dayOfInstant,
  daysFromToday,
  shiftDateKey,
  weekStartInstant,
  weekStartKey,
} from '../domain/rating-goal-weeks'
import type { PropertyRatingGoal } from '../domain/rating-goal'
import type {
  RatingGoalCardView,
  RatingGoalChartPoint,
  RatingGoalChartView,
  RatingGoalDetailView,
  RatingGoalMovedEvents,
  RatingGoalPlanSoFarView,
} from './dto/rating-goal.types'
import type { RatingGoalChangeLog } from './ports/property-rating-goal.repository'
import type { RatingGoalReading } from './rating-goal-reading'
import { cardRate } from './rating-goal-tracking-views'
import { goalBasis } from './rating-goal-views'

const MILLION = 1_000_000
const LOWEST_TENTHS = 10
const FOUR_WEEKS_DAYS = 28

export type RatingGoalDetailReads = Readonly<{
  history: GoogleRatingHistory
  shown: readonly GoogleShownNumber[]
  changes: RatingGoalChangeLog
}>

type Detail = Readonly<{
  goal: PropertyRatingGoal
  reading: RatingGoalReading
  card: RatingGoalCardView
  reads: RatingGoalDetailReads
}>

const thousandthsOf = (value: Ratio): number =>
  Number((2n * value.num * 1000n + value.den) / (2n * value.den))

/** The detail's chart starts here (Monday of the set's week − 4 weeks, a year back at most). */
export const detailChartStart = (goal: PropertyRatingGoal, reading: RatingGoalReading) =>
  chartStart(goal.createdAt, reading.now, reading.facts.timezone)

/**
 * The weekly history is read from the chart's start, or from the Monday of the
 * latest plan change's week when that is earlier: the cone starts from the
 * average there (E15), and the chart still starts where it does.
 */
export function detailHistoryStart(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
  changes: RatingGoalChangeLog,
): Readonly<{ key: string; instant: Date }> {
  const start = detailChartStart(goal, reading)
  const latest = changes.recent[0]
  if (latest === undefined) return start
  const { timezone } = reading.facts
  const key = weekStartKey(latest.changedAt, timezone)
  return key < start.key
    ? { key, instant: weekStartInstant(latest.changedAt, timezone) }
    : start
}

/**
 * The exact average at each Monday from the history's start to this week's
 * (flat through a week without reviews): a Monday stands where the week before
 * it ended. None while the cache lacks some of Google's reviews.
 */
function mondayPoints(
  detail: Detail,
  startKey: string,
): readonly RatingGoalChartPoint[] | null {
  const { reading, reads } = detail
  if (reading.exact?.source !== 'cache') return null
  const { now } = reading
  const { timezone } = reading.facts
  const ends = new Map(
    reads.history.weeks.map((week) => [week.weekStart, week.endAverageThousandths]),
  )
  return chartWeeks(startKey, now, timezone).reduce<
    Readonly<{ value: number | null; points: readonly RatingGoalChartPoint[] }>
  >(
    ({ value, points }, monday) => ({
      points:
        value === null
          ? points
          : [
              ...points,
              { day: daysFromToday(monday, now, timezone), thousandths: value },
            ],
      value: ends.get(monday) ?? value,
    }),
    { value: reads.history.startAverageThousandths, points: [] },
  ).points
}

/** The line drawn: the Mondays from the chart's first day, before today, then today. */
function historyLine(
  detail: Detail,
  mondays: readonly RatingGoalChartPoint[] | null,
  firstDay: number,
): RatingGoalChartPoint[] | null {
  const { exact } = detail.reading
  if (mondays === null || exact?.source !== 'cache') return null
  return [
    ...mondays.filter((point) => point.day >= firstDay && point.day < 0),
    { day: 0, thousandths: thousandthsOf(exact.value) },
  ]
}

/** The exact average stored at the set, as an exact fraction (millionths). */
const baselineExact = (goal: PropertyRatingGoal): Ratio =>
  ratio(Math.round(goal.baseline.exactAverage * MILLION), MILLION)

type Anchor = Readonly<{ kind: 'set' | 'changed'; day: number; start: ClimbStart | null }>

/**
 * Where the plan's cone starts: the latest plan change, else the set (E15). A
 * change starts from its week's Monday, found among the Mondays (this one
 * included) before today's point is added: today's average already holds
 * today's reviews, which the count leaves out.
 */
function anchorOf(
  detail: Detail,
  mondays: readonly RatingGoalChartPoint[] | null,
): Anchor {
  const { goal, reading, reads } = detail
  const { now } = reading
  const { timezone } = reading.facts
  const latest = reads.changes.recent[0]
  if (latest === undefined) {
    const day = dayOfInstant(goal.createdAt, now, timezone)
    const start = {
      reviewCount: goal.baseline.reviewCount,
      exact: baselineExact(goal),
      day,
    }
    return { kind: 'set', day, start }
  }
  const monday = weekStartKey(latest.changedAt, timezone)
  const day = daysFromToday(monday, now, timezone)
  const point = mondays?.find((each) => each.day === day)
  if (point === undefined || reading.google === null)
    return { kind: 'changed', day, start: null }
  const since = reads.history.weeks
    .filter((week) => week.weekStart >= monday)
    .reduce((sum, week) => sum + week.count, 0)
  const start = {
    reviewCount: reading.google.reviewCount - since,
    exact: ratio(point.thousandths, 1000),
    day,
  }
  return { kind: 'changed', day, start }
}

/** A line for each tenth from below where the goal started (or today) to above the goal. */
function thresholdsOf(goal: PropertyRatingGoal, reading: RatingGoalReading) {
  const started = displayedTenths(goal.baseline.googleAverage)
  const shown = reading.google?.displayedTenths ?? started
  const lowest = Math.max(LOWEST_TENTHS, Math.min(started, shown) - 1)
  const highest = Math.min(PERFECT_TENTHS, goal.targetTenths + 1)
  return Array.from({ length: Math.max(0, highest - lowest + 1) }, (_, index) => ({
    tenths: lowest + index,
    thousandths: thresholdThousandths(lowest + index),
  }))
}

type ShownMove = Readonly<{ at: Date; tenths: number; up: boolean }>

/** Each move of Google's own number after the first snapshot read (the one in force at the start). */
function shownMoves(shown: readonly GoogleShownNumber[]): readonly ShownMove[] {
  const tenths = shown.flatMap((row) =>
    row.averageRating === null
      ? []
      : [{ at: row.at, tenths: displayedTenths(row.averageRating) }],
  )
  return tenths.slice(1).flatMap((row, index) => {
    const before = tenths[index]?.tenths
    return before === undefined || before === row.tenths
      ? []
      : [{ at: row.at, tenths: row.tenths, up: row.tenths > before }]
  })
}

/**
 * Google's moves since the goal was set, oldest first: the chart's dots and
 * the rows of "What moved you" are the same moves, so the chart is never the
 * only place one is told.
 */
const movesSinceSet = (detail: Detail): readonly ShownMove[] =>
  shownMoves(detail.reads.shown).filter(
    (move) => move.at.getTime() >= detail.goal.createdAt.getTime(),
  )

/** The likely band: the card's own arrival, from today (E16); none without one. */
function likelyOf(detail: Detail): RatingGoalChartView['likely'] {
  const { goal, reading, card } = detail
  const numbers = goalBasis(goal, reading)
  const rate = cardRate(goal, reading)
  if (
    goal.state !== 'active' ||
    card.forecast?.kind !== 'days' ||
    numbers === null ||
    rate === null
  ) {
    return []
  }
  return likelyBand({
    reviewCount: numbers.basis.reviewCount,
    exact: numbers.basis.exact,
    targetTenths: goal.targetTenths,
    mix: numbers.basis.mix,
    rate: rate.rate,
    slow: card.forecast.slow,
  })
}

function chartView(detail: Detail): RatingGoalChartView | null {
  const { goal, reading } = detail
  if (
    goal.mode === 'keep' ||
    goal.qualityTenths === null ||
    goal.paceTenthsPerWeek === null
  ) {
    return null
  }
  const { now } = reading
  const { timezone } = reading.facts
  const start = detailChartStart(goal, reading)
  const firstDay = daysFromToday(start.key, now, timezone)
  const mondays = mondayPoints(
    detail,
    detailHistoryStart(goal, reading, detail.reads.changes).key,
  )
  const history = historyLine(detail, mondays, firstDay)
  const anchor = anchorOf(detail, mondays)
  return {
    firstDay,
    history,
    thresholds: thresholdsOf(goal, reading),
    anchor: {
      day: anchor.day,
      kind: anchor.kind,
      paceTenthsPerWeek: goal.paceTenthsPerWeek,
      qualityTenths: goal.qualityTenths,
    },
    plan:
      anchor.start === null
        ? []
        : planCone({
            start: anchor.start,
            qualityTenths: goal.qualityTenths,
            paceTenthsPerWeek: goal.paceTenthsPerWeek,
            targetTenths: goal.targetTenths,
            firstDay,
          }),
    likely: likelyOf(detail),
    shownChanges: movesSinceSet(detail)
      .map((move) => ({
        day: dayOfInstant(move.at, now, timezone),
        tenths: move.tenths,
        up: move.up,
      }))
      .filter((move) => move.day >= firstDay),
    today: reading.exact?.source === 'cache' ? thousandthsOf(reading.exact.value) : null,
  }
}

/** The four full weeks before the set's week against the last four (null when the chart starts later). */
function planSoFarView(detail: Detail): RatingGoalPlanSoFarView {
  const { goal, reading, reads } = detail
  if (goal.mode === 'keep') return { prePlan: null, reachedTenths: null }
  const { timezone } = reading.facts
  const setMonday = weekStartKey(goal.createdAt, timezone)
  const from = shiftDateKey(setMonday, -FOUR_WEEKS_DAYS)
  const reaches = detailChartStart(goal, reading).key === from
  const before = reads.history.weeks
    .filter((week) => week.weekStart >= from && week.weekStart < setMonday)
    .reduce((sum, week) => sum + week.count, 0)
  const lately = reading.reviewsLast28Days
  const started = displayedTenths(goal.baseline.googleAverage)
  const shown = reading.google?.displayedTenths ?? null
  return {
    prePlan: reaches
      ? {
          perMonth: perMonthOf28Days(before),
          trend: lately > before ? 'up' : lately < before ? 'down' : 'same',
        }
      : null,
    reachedTenths: shown !== null && shown > started ? shown : null,
  }
}

function movedView(detail: Detail): RatingGoalMovedEvents {
  const { goal, reads } = detail
  const set = initialPlan(
    { targetTenths: goal.targetTenths, paceTenthsPerWeek: goal.paceTenthsPerWeek },
    reads.changes.firstPerField,
  )
  return {
    shownChanges: movesSinceSet(detail)
      .map((move) => ({ at: move.at.toISOString(), tenths: move.tenths, up: move.up }))
      .reverse(),
    setBy: goal.createdBy,
    initialTargetTenths: set.targetTenths,
    initialPaceTenthsPerWeek: set.paceTenthsPerWeek,
  }
}

/**
 * What the detail adds to the card: the chart, the plan so far and what moved
 * the goal (without this week's stars and the low reviews, which the read
 * adds, rating-goal-low-reviews.ts).
 */
export const detailTracking = (
  detail: Detail,
): Pick<RatingGoalDetailView, 'chart' | 'planSoFar'> &
  Readonly<{ moved: RatingGoalMovedEvents }> => ({
  chart: chartView(detail),
  planSoFar: planSoFarView(detail),
  moved: movedView(detail),
})
