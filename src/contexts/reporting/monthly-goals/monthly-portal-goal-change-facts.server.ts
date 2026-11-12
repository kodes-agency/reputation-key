// The change sheet describes the engine's month-target and revision commands
// (ADR 0068). The current month stays editable through its last day; default to
// the next month after local day 20 to avoid an unasked late below-pace raise.
// A stopped goal cannot change; offer a new one only after its windows end.

import {
  defaultGoalStartMonth,
  firstFullMonthlyPeriodAtOrAfter,
  monthKeyOf,
} from '../domain/goal-start'
import type { PortalGoalRecommendation } from './contracts'
import type { PortalGoalChangeFacts } from './contracts'
import { monthTargetPlan } from '../application/goal-month-target-plan'
import { nextRevisionStart } from '../application/goal-revision-start'
import type { PropertyCountGoal } from '../application/monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'

/**
 * What a change is sent against, as of `now`; null once the goal has ended.
 * Portal, group and average goals stop against the same facts.
 */
export function changeFactsOf(
  bundle: GoalProgramBundle,
  now: Date,
  timezone: string,
): PortalGoalChangeFacts | null {
  if (bundle.program.status === 'ended') return null
  const plan = monthTargetPlan(bundle, now, timezone)
  const running =
    plan === null
      ? null
      : {
          monthKey: plan.monthKey,
          expectedTarget: plan.effectiveTarget,
          expectedVersion: bundle.program.currentVersion,
          expectedFollowingMonth: plan.followingMonthKey,
          appliesToFollowing: plan.canApplyFollowing,
          period: {
            start: plan.period.start.toISOString(),
            end: plan.period.end.toISOString(),
          },
          // The month's days are drawn in the zone it was cut in.
          timezone: plan.inForceVersion.propertyTimezone,
        }
  const { period } = nextRevisionStart(bundle, now, timezone)
  return {
    now: running,
    nextMonthKey: monthKeyOf(period.start, timezone),
    opensOn:
      running !== null && defaultGoalStartMonth(now, timezone) === running.monthKey
        ? 'now'
        : 'next',
  }
}

/**
 * A stopped goal's way on: the first whole month after its windows end, when
 * the set sheet offers it (this month or the next); else null. Its windows
 * end with the last month it counts, or at the stop itself when that came
 * before this month was opened: a goal from that month would meet it.
 */
export function newGoalFromOf(
  bundle: PropertyCountGoal,
  timezone: string,
  months: PortalGoalRecommendation['months'],
): string | null {
  if (bundle.program.status !== 'ended') return null
  const ends = bundle.assignments.map(({ effectiveTo }) => effectiveTo)
  if (ends.length === 0 || ends.some((end) => end === null)) return null
  const end = Math.max(...ends.map((at) => at?.getTime() ?? 0))
  const { start } = firstFullMonthlyPeriodAtOrAfter(new Date(end), timezone)
  const free = monthKeyOf(start, timezone)
  return free === months.current.key || free === months.next.key ? free : null
}
