// Property Google rating goal — what the detail page draws (pure).
//
// 2026-11-01 (ADR 0067): the line to the goal (the exact average over time from
// Review's week-end averages, a line for each tenth, the day the goal was set and
// Google's own moves), the new reviews of each week, the pace before the goal and
// the rows of "What happened" that carry no per-review value. Days are whole
// Property-local days from today; star values thousandths, half up. A partial
// cache draws no history: the line would be the cache's, not Google's.

import type {
  GoogleRatingHistory,
  GoogleShownNumber,
} from '#/contexts/review/application/public-api'
import { initialPlan, perMonthOf28Days } from '../domain/rating-goal-climb'
import {
  displayedTenths,
  thresholdThousandths,
  type Ratio,
} from '../domain/rating-goal-numbers'
import { PERFECT_TENTHS } from '../domain/rating-goal-stops'
import {
  chartStart,
  chartWeeks,
  dayOfInstant,
  daysFromToday,
  localDateKey,
  shiftDateKey,
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
 * the rows of "What happened" are the same moves, so the chart is never the
 * only place one is told.
 */
const movesSinceSet = (detail: Detail): readonly ShownMove[] =>
  shownMoves(detail.reads.shown).filter(
    (move) => move.at.getTime() >= detail.goal.createdAt.getTime(),
  )

/** Each week's new reviews, a week without any included: the bars need its zero. */
function weekCounts(detail: Detail, startKey: string): RatingGoalChartView['weeks'] {
  const { reading, reads } = detail
  const { now } = reading
  const { timezone } = reading.facts
  const counts = new Map(reads.history.weeks.map((week) => [week.weekStart, week.count]))
  return chartWeeks(startKey, now, timezone).map((monday) => ({
    day: daysFromToday(monday, now, timezone),
    count: counts.get(monday) ?? 0,
  }))
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
  const mondays = mondayPoints(detail, start.key)
  return {
    todayKey: localDateKey(now, timezone),
    firstDay,
    setDay: dayOfInstant(goal.createdAt, now, timezone),
    history: historyLine(detail, mondays, firstDay),
    thresholds: thresholdsOf(goal, reading),
    shownChanges: movesSinceSet(detail)
      .map((move) => ({
        day: dayOfInstant(move.at, now, timezone),
        tenths: move.tenths,
        up: move.up,
      }))
      .filter((move) => move.day >= firstDay),
    today: reading.exact?.source === 'cache' ? thousandthsOf(reading.exact.value) : null,
    weeks: weekCounts(detail, start.key),
  }
}

/** The four full weeks before the set's week against the last four (null when the chart starts later). */
function planSoFarView(detail: Detail): RatingGoalPlanSoFarView {
  const { goal, reading, reads } = detail
  if (goal.mode === 'keep') return { prePlan: null }
  const { timezone } = reading.facts
  const setMonday = weekStartKey(goal.createdAt, timezone)
  const from = shiftDateKey(setMonday, -FOUR_WEEKS_DAYS)
  const reaches = detailChartStart(goal, reading).key === from
  const before = reads.history.weeks
    .filter((week) => week.weekStart >= from && week.weekStart < setMonday)
    .reduce((sum, week) => sum + week.count, 0)
  const lately = reading.reviewsLast28Days
  return {
    prePlan: reaches
      ? {
          perMonth: perMonthOf28Days(before),
          trend: lately > before ? 'up' : lately < before ? 'down' : 'same',
        }
      : null,
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
 * What the detail adds to the card: the charts, the pace before the goal and what
 * moved it (without this week's stars and the low reviews, which the read adds,
 * rating-goal-low-reviews.ts).
 */
export const detailTracking = (
  detail: Detail,
): Pick<RatingGoalDetailView, 'chart' | 'planSoFar'> &
  Readonly<{ moved: RatingGoalMovedEvents }> => ({
  chart: chartView(detail),
  planSoFar: planSoFarView(detail),
  moved: movedView(detail),
})
