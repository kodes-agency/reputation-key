// When a new goal starts, and the month a change to a goal starts in.
//
// A goal starts in the current month of the Property's calendar or in the next
// one, chosen when it is created. The choice travels as the month itself
// (`YYYY-MM`), never as "this" or "next", so it cannot drift when a form is
// left open across the last midnight of a month.
//
// Its own module, apart from the Program's other rules, because the new-goal
// form and the dialogs that change a goal run it in the browser: the Program
// module is part of the first-paint bundle (the command DTO imports it), and
// this calendar code must not be.
import {
  calendarPeriodRange,
  dayKeyInTimezone,
  localDayOfMonth,
} from '#/shared/domain/period-range'

/**
 * The last local day of the month on which a new goal still counts for that
 * month by default. From the next day on the default is the following month.
 */
export const GOAL_CURRENT_MONTH_CUTOFF_DAY = 20

export type GoalMonthlyPeriod = Readonly<{ start: Date; end: Date }>

/**
 * First complete property-local month that does not start before `at`. The
 * local month containing `at` can start after it: an instant inside a repeated
 * midnight hour belongs to the new local month, whose first instant is the
 * midnight's later occurrence.
 */
export function firstFullMonthlyPeriodAtOrAfter(
  at: Date,
  timezone: string,
): GoalMonthlyPeriod {
  const current = calendarPeriodRange(at, timezone, 'monthly')
  if (at.getTime() <= current.start.getTime()) return current
  return calendarPeriodRange(current.end, timezone, 'monthly')
}

/** A month a new goal may start in: its `YYYY-MM` key on the Property's calendar. */
export type GoalStartOption = Readonly<{
  monthKey: string
  period: GoalMonthlyPeriod
}>

/** `YYYY-MM` of the local month that begins at `monthStart`. */
export const monthKeyOf = (monthStart: Date, timezone: string): string =>
  dayKeyInTimezone(monthStart, timezone).slice(0, 7).replace('_', '-')

/**
 * The two months a new goal may start in: the Property-local month that
 * contains `now`, and the one after it. Each is a complete local month.
 */
export function goalStartOptions(
  now: Date,
  timezone: string,
): Readonly<{ current: GoalStartOption; next: GoalStartOption }> {
  const current = calendarPeriodRange(now, timezone, 'monthly')
  const next = calendarPeriodRange(current.end, timezone, 'monthly')
  return {
    current: { monthKey: monthKeyOf(current.start, timezone), period: current },
    next: { monthKey: monthKeyOf(next.start, timezone), period: next },
  }
}

/**
 * The month key a new goal starts in unless its creator picks the other one:
 * the current local month up to and including the cut-off day, then the next.
 */
export function defaultGoalStartMonth(now: Date, timezone: string): string {
  const options = goalStartOptions(now, timezone)
  return localDayOfMonth(now, timezone) <= GOAL_CURRENT_MONTH_CUTOFF_DAY
    ? options.current.monthKey
    : options.next.monthKey
}

export type GoalStartResolution =
  | Readonly<{ ok: true; period: GoalMonthlyPeriod }>
  | Readonly<{ ok: false; reason: 'start_month_changed' }>

/**
 * The month a new goal starts in. A month key must name the current or the
 * next Property-local month as of `now`; any other key is refused rather than
 * moved, because the month changed after the choice was made. With no key the
 * goal keeps the first full month that does not start before `now`.
 */
export function resolveGoalStart(
  now: Date,
  timezone: string,
  startMonth?: string,
): GoalStartResolution {
  if (startMonth === undefined) {
    return { ok: true, period: firstFullMonthlyPeriodAtOrAfter(now, timezone) }
  }
  const { current, next } = goalStartOptions(now, timezone)
  const chosen = [current, next].find((option) => option.monthKey === startMonth)
  return chosen
    ? { ok: true, period: chosen.period }
    : { ok: false, reason: 'start_month_changed' }
}
