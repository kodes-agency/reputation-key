// Property Google rating goal — when the Monday check-in shows (pure).
//
// Round 5 (PLAN-D D-3, owner answer Q4, E29): every Property-local week, from
// Monday 00:00 to Sunday 24:00, a climb goal's card looks back on last week
// and asks its managers to keep the pace, raise it or ease it. Never
// automatic: nothing changes unless a manager chooses. It is a card on the
// page only, never a notice (Q11 stands).
//
// It shows for an active climb goal that is getting started, on pace or below
// pace (never while new reviews are too low, while Google's numbers wait, or
// while Google lags on the goal itself: Raise or Ease does not answer those),
// once last week began on or after the set. It is answered for every manager
// by a Keep of last week (`recapAnsweredWeek`, its Monday) or by any change of
// the pace this week. Last week is compared with a plan only when the pace in
// force at its Monday is today's; after a change during it, its count alone.

import type { PropertyRatingGoal, RatingGoalStatus } from './rating-goal'
import {
  previousWeekStartInstant,
  shiftDateKey,
  weekStartInstant,
  weekStartKey,
} from './rating-goal-weeks'

/** The statuses a check-in can be answered from by keeping, raising or easing the pace. */
const RECAP_STATUSES: ReadonlySet<RatingGoalStatus> = new Set([
  'getting_started',
  'on_pace',
  'below_pace',
])

export type RecapGoal = Pick<
  PropertyRatingGoal,
  'mode' | 'state' | 'paceTenthsPerWeek' | 'createdAt' | 'paceSince' | 'recapAnsweredWeek'
>

export type WeeklyRecapInput = Readonly<{
  goal: RecapGoal
  status: RatingGoalStatus
  /** The reviews already clear the goal; Google does not show it yet. */
  googleShowsSoon: boolean
  now: Date
  timezone: string
}>

export type WeeklyRecapDue = Readonly<{
  /** Last week's Monday, `YYYY-MM-DD`: the week the check-in looks back on, and what Keep answers. */
  weekStart: string
  /** The pace in force at last Monday is today's, so last week has one plan to compare with. */
  compared: boolean
}>

const isClimbing = (goal: RecapGoal): boolean =>
  goal.mode === 'climb' && goal.state === 'active' && goal.paceTenthsPerWeek !== null

/** The check-in due on the card now, or null. */
export function weeklyRecapDue(input: WeeklyRecapInput): WeeklyRecapDue | null {
  const { goal, now, timezone } = input
  if (!isClimbing(goal) || !RECAP_STATUSES.has(input.status) || input.googleShowsSoon) {
    return null
  }
  const lastMonday = previousWeekStartInstant(now, timezone)
  if (lastMonday.getTime() < goal.createdAt.getTime()) return null
  const weekStart = shiftDateKey(weekStartKey(now, timezone), -7)
  const changedThisWeek =
    goal.paceSince.getTime() >= weekStartInstant(now, timezone).getTime()
  if (goal.recapAnsweredWeek === weekStart || changedThisWeek) return null
  return { weekStart, compared: goal.paceSince.getTime() <= lastMonday.getTime() }
}
