// Property Google rating goal — the Monday check-in on the card (pure).
//
// Round 5 (PLAN-D D-3, owner answer Q4): when the check-in is due
// (domain/rating-goal-recap.ts), the card read hands on last week's count, its
// average as a tenth only from ten reviews (Review gives no week sum under
// ten), the whole reviews a week the plan asked for when last week had one
// plan, and the paces Raise and Ease move to (E27). All from the one card
// read: no new query.

import type { GoogleRatingRangeTotals } from '#/contexts/review/application/public-api'
import type { PropertyRatingGoal, RatingGoalStatus } from '../domain/rating-goal'
import { ratio } from '../domain/rating-goal-numbers'
import { weeklyPlanCount } from '../domain/rating-goal-pace'
import { easedPace, raisedPace } from '../domain/rating-goal-pace-chips'
import { nearestTenth } from '../domain/rating-goal-quality'
import { weeklyRecapDue } from '../domain/rating-goal-recap'
import type { RatingGoalRecapView } from './dto/rating-goal.types'

export type RecapFacts = Readonly<{
  status: RatingGoalStatus
  googleShowsSoon: boolean
  lastWeek: GoogleRatingRangeTotals
  now: Date
  timezone: string
}>

/** The check-in the card carries, or null while none is due. */
export function recapView(
  goal: PropertyRatingGoal,
  facts: RecapFacts,
): RatingGoalRecapView | null {
  const pace = goal.paceTenthsPerWeek
  const due = weeklyRecapDue({ goal, ...facts })
  if (due === null || pace === null) return null
  const { count, sum } = facts.lastWeek
  return {
    weekStart: due.weekStart,
    count,
    averageTenths: sum === null || count === 0 ? null : nearestTenth(ratio(sum, count)),
    plannedLastWeek: due.compared ? weeklyPlanCount(pace) : null,
    raiseToTenths: raisedPace(pace),
    easeToTenths: easedPace(pace),
  }
}
