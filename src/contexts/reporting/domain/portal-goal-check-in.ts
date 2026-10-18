// Monthly portal goal — the month-start check-in (ADR 0068 decision 8, PLAN
// PG-15).
//
// On local days 1 to 7 of a month that is not the goal's first, the goal's
// card asks once whether the month keeps its number: Use the recommended one
// when it differs ("Use 45"), Keep the one it has ("Keep 40"), or another
// number. Nothing changes unless a manager chooses, and nothing is automatic:
// an ignored check-in keeps the number and folds away after the 7th. It asks
// only while the goal runs, and once a month: Keep records the month it
// answered, and a change of this month's own number (Use, or another number
// through the sheet) answers it as well. When the recommended number is the
// month's already, it is one line, not a choice; when nothing came in over the
// basis there is no number to offer, only Keep and another number; and with no
// recommendation that can be read, it asks nothing. The days are the
// Property's local days, so a clock change never moves one. Pure.
import type { GoalProgramStatus } from './goal-program'
import type { Choices } from './goal-recommendation-types'
import { localDateOf } from './local-days'

/** The check-in is open through this local day of the month. */
const CHECK_IN_LAST_DAY = 7

/** The month whose check-in is open at `now`: this local month on days 1 to 7, else none. */
export function checkInMonthAt(now: Date, timezone: string): string | null {
  const today = localDateOf(now, timezone)
  return Number(today.slice(8, 10)) <= CHECK_IN_LAST_DAY ? today.slice(0, 7) : null
}

export type MonthlyCheckInInput = Readonly<{
  now: Date
  /** The zone the goal's months are cut in. */
  timezone: string
  goal: Readonly<{
    status: GoalProgramStatus
    /** `YYYY-MM` of the goal's first month. */
    firstMonthKey: string
    /** The number this month is judged against now. */
    currentTarget: number
  }>
  /** The month whose check-in was answered with Keep, if any. */
  answeredMonth: string | null
  /** This month's own number was changed since the month began. */
  changedThisMonth: boolean
  /**
   * This month's recommended number, in what the month counts; `'nothing'`
   * when nothing of it came in over the basis; null when no recommendation can
   * be read.
   */
  recommendation: Pick<Choices, 'aBitMore'> | 'nothing' | null
}>

export type MonthlyCheckIn =
  /** "Use 45", "Keep 40", or another number. */
  | Readonly<{ kind: 'offer'; month: string; number: number }>
  /** The recommended number is the month's already: a line under the card. */
  | Readonly<{ kind: 'same'; month: string }>
  /** No number to offer: "Keep 40", or another number. */
  | Readonly<{ kind: 'nothing'; month: string }>

/** The check-in the goal's card shows at `now`, or none. */
export function monthlyCheckIn(input: MonthlyCheckInInput): MonthlyCheckIn | null {
  const { goal, recommendation } = input
  const month = checkInMonthAt(input.now, input.timezone)
  if (month === null || goal.status !== 'active') return null
  // Its first month has nothing to check: the number was just set for it.
  if (goal.firstMonthKey >= month) return null
  if (input.answeredMonth === month || input.changedThisMonth) return null
  if (recommendation === null) return null
  if (recommendation === 'nothing') return { kind: 'nothing', month }
  return recommendation.aBitMore === goal.currentTarget
    ? { kind: 'same', month }
    : { kind: 'offer', month, number: recommendation.aBitMore }
}
