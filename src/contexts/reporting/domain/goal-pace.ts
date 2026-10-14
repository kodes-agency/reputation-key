// How far a count goal's month should have got by now.
//
// "Behind pace" is a nudge, not a result: it compares the live month to date
// with a straight line from zero to the month's target and says nothing about
// whether the month will be met. One rule, used wherever a goal is called
// behind pace (a Goals row, the Overview chip, the Properties list), so none of
// them can disagree about it.
//
// - A count measure expects the target times the share of the month that has
//   passed. The share counts whole Property-local calendar days with today
//   included, the way Portal Results windows do (`localDaysWindow`).
// - It is behind pace when the count is below 90% of what the line expects.
//   Exactly 90% is on pace.
// - The first three days of a month are not judged: a few days of a count say
//   little, and the month has only just begun.
// - An average has no pace. It is a level to hold, not a total to build up.
//
// Pure, and built on integers so a count on the edge is decided exactly.

import { dayKeyInTimezone } from '#/shared/domain/period-range'
import type { GoalMetric } from './goal-program'

/** A count under this percentage of what the straight line expects is behind pace. */
export const GOAL_PACE_THRESHOLD_PERCENT = 90

/** Days at the start of a month that are never judged. */
export const GOAL_PACE_QUIET_DAYS = 3

const DAY_MS = 86_400_000

export type GoalPaceState =
  /** Below the threshold of the straight line. */
  | 'behind'
  /** At or above it. */
  | 'on_pace'
  /** Within the first days of the month, which are not judged. */
  | 'too_early'
  /** An average, which has no pace. */
  | 'not_applicable'

export type GoalPaceInput = Readonly<{
  metric: GoalMetric
  /** The month to date. */
  value: number
  /** What the month is judged against. */
  target: number
  /** The half-open month the figure is for. */
  period: Readonly<{ start: Date; end: Date }>
  now: Date
  /** The Property's time zone, which draws the days. */
  timezone: string
}>

export type GoalMonthDays = Readonly<{
  /** Whole local days that have begun, today included. */
  elapsedDays: number
  /** Local days in the month. */
  totalDays: number
  /** Whole local days still to begin after today. */
  daysLeft: number
}>

export type GoalPace = GoalMonthDays &
  Readonly<{
    state: GoalPaceState
  }>

/** The local calendar day as a count of days, so two days subtract. */
function localDayNumber(instant: Date, timezone: string): number {
  const [year, month, day] = dayKeyInTimezone(instant, timezone).split('_').map(Number)
  return Date.UTC(year!, month! - 1, day!) / DAY_MS
}

/**
 * How much of a month has gone, in whole Property-local days with today
 * included. A clock outside the month reads as its first or last day.
 */
export function goalMonthDays(
  period: Readonly<{ start: Date; end: Date }>,
  now: Date,
  timezone: string,
): GoalMonthDays {
  const first = localDayNumber(period.start, timezone)
  const last = localDayNumber(new Date(period.end.getTime() - 1), timezone)
  const totalDays = last - first + 1
  const elapsedDays = Math.min(
    totalDays,
    Math.max(0, localDayNumber(now, timezone) - first + 1),
  )
  return { elapsedDays, totalDays, daysLeft: totalDays - elapsedDays }
}

function isCount(metric: GoalMetric): boolean {
  return metric !== 'portal_rating_average'
}

/** A count is behind when `value < 90% x target x elapsed / total`, compared whole. */
function isBelowThreshold(
  value: number,
  target: number,
  elapsedDays: number,
  totalDays: number,
): boolean {
  return value * totalDays * 100 < GOAL_PACE_THRESHOLD_PERCENT * target * elapsedDays
}

export function goalPace(input: GoalPaceInput): GoalPace {
  const days = goalMonthDays(input.period, input.now, input.timezone)
  if (!isCount(input.metric)) return { state: 'not_applicable', ...days }
  if (days.elapsedDays <= GOAL_PACE_QUIET_DAYS) return { state: 'too_early', ...days }
  const behind = isBelowThreshold(
    input.value,
    input.target,
    days.elapsedDays,
    days.totalDays,
  )
  return { state: behind ? 'behind' : 'on_pace', ...days }
}

/** A count goal's month that is running, with the figure it has reached. */
export type RunningCountMonth = Readonly<{
  propertyId: string
  programId: string
  metric: Exclude<GoalMetric, 'portal_rating_average'>
  /** The half-open month, in the Program's time zone. */
  period: Readonly<{ start: Date; end: Date }>
  timezone: string
  /** What the month is judged against: its own target, else its version's. */
  target: number
  /** The month to date; null when the readings under it cannot be counted safely. */
  value: number | null
}>

/**
 * How many goals of each Property are behind pace now. A goal is counted once,
 * however many of its subjects are, because the Overview and the Properties list
 * say "goals". A month whose figure cannot be read is not counted: a nudge never
 * rests on a number that is not trusted.
 */
export function goalsBehindPaceByProperty(
  months: readonly RunningCountMonth[],
  now: Date,
): ReadonlyMap<string, number> {
  const behind = new Map<string, ReadonlySet<string>>()
  for (const month of months) {
    if (month.value === null) continue
    const { state } = goalPace({
      metric: month.metric,
      value: month.value,
      target: month.target,
      period: month.period,
      now,
      timezone: month.timezone,
    })
    if (state !== 'behind') continue
    behind.set(
      month.propertyId,
      new Set([...(behind.get(month.propertyId) ?? []), month.programId]),
    )
  }
  return new Map([...behind].map(([propertyId, goals]) => [propertyId, goals.size]))
}
