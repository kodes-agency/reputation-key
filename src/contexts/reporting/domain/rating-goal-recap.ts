// The weekly check-in is a page card, never a notice or automatic change.
// An active climb goal asks after a whole Property-local week, except when
// reviews are too low or Google is waiting/lagging on the goal. Keep answers for
// all managers, as does changing pace this week. Compare last week against a
// plan only if its Monday pace is still current; otherwise show its count alone.

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

/** Last week's Monday, `YYYY-MM-DD`: the only week a check-in open now can answer. */
export const recapWeekStart = (now: Date, timezone: string): string =>
  shiftDateKey(weekStartKey(now, timezone), -7)

/** The check-in due on the card now, or null. */
export function weeklyRecapDue(input: WeeklyRecapInput): WeeklyRecapDue | null {
  const { goal, now, timezone } = input
  if (!isClimbing(goal) || !RECAP_STATUSES.has(input.status) || input.googleShowsSoon) {
    return null
  }
  const lastMonday = previousWeekStartInstant(now, timezone)
  if (lastMonday.getTime() < goal.createdAt.getTime()) return null
  const weekStart = recapWeekStart(now, timezone)
  const changedThisWeek =
    goal.paceSince.getTime() >= weekStartInstant(now, timezone).getTime()
  if (goal.recapAnsweredWeek === weekStart || changedThisWeek) return null
  return { weekStart, compared: goal.paceSince.getTime() <= lastMonday.getTime() }
}
