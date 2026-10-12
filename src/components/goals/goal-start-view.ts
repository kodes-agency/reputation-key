// When a new goal starts: the two months the form offers, and their words.
//
// A goal starts in the current month of the Property's calendar or in the next
// one. The form offers both by month key (`YYYY-MM`) and submits the key, so a
// form left open across midnight on the last day cannot quietly move a goal to
// another month: the command refuses a key that is no longer offered, and the
// page reads the options again.
import {
  defaultGoalStartMonth,
  goalStartOptions,
} from '#/contexts/reporting/application/dto/goal-program.dto'
import { formatShortDate } from '#/lib/format'

export type GoalStartChoice = ReturnType<typeof goalStartOptions> &
  Readonly<{
    /** The month a goal starts in until its creator picks the other one. */
    defaultMonth: string
  }>

/** The months a goal created at `now` may start in, and the one chosen by default. */
export function goalStartChoice(now: Date, timezone: string): GoalStartChoice {
  return {
    ...goalStartOptions(now, timezone),
    defaultMonth: defaultGoalStartMonth(now, timezone),
  }
}

/**
 * The month the form submits: the person's pick while it is still offered,
 * otherwise the default. A pick stops being offered when the month changes
 * while the form is open.
 */
export function offeredStartMonth(
  choice: GoalStartChoice,
  picked: string | null,
): string {
  return picked === choice.current.monthKey || picked === choice.next.monthKey
    ? picked
    : choice.defaultMonth
}

/** What each option says, with the day it counts from. */
export function goalStartLabels(
  choice: GoalStartChoice,
  timezone: string,
  now: Date,
): Readonly<{ current: string; next: string }> {
  const day = (monthStart: Date) =>
    formatShortDate(monthStart, timezone, now) ?? 'its first day'
  return {
    current: `This month — counts everything since ${day(choice.current.period.start)}`,
    next: `Next month — starts ${day(choice.next.period.start)}`,
  }
}
