// On local days 1–7, after a goal's first month, ask once whether to keep or
// change the running target (ADR 0068). Ignoring it keeps the target; Keep or a
// change to this month's number answers it. Equal recommendations need no choice;
// zero basis offers only Keep/own, and unreadable recommendations ask nothing.

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
