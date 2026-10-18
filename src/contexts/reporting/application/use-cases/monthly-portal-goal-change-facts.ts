// Reporting — what a change to the Monthly portal goal is made against (ADR
// 0068, PLAN PG-14).
//
// The sheet's two ways to change the goal are the engine's own commands, so it
// is told what each of them checks: "November, now" changes the running month
// and the months after it (the month-target plan: the month, its number now,
// the version, and the month the months after start with; or the month alone,
// while a change of the other measure waits for the next); "From Dec 1" and
// "Count scans instead" change the goal from its next month (the month the
// next revision starts with). Its last day, a month can still change: a
// month's number locks only once the month has ended. The sheet opens on now
// through the 20th local day, as a new goal does, and on the next month after
// it, so a raise late in a month never makes it "below pace" unasked. A
// stopped goal takes no change; once its last month is over a new goal can
// start, which the stopped card offers when the set sheet has that month. Pure.
import { defaultGoalStartMonth, monthKeyOf } from '../../domain/goal-start'
import { addLocalDays } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalOfCard,
} from '../dto/monthly-portal-goal.types'
import { monthTargetPlan } from '../goal-month-target-plan'
import { nextRevisionStart } from '../goal-revision-start'
import type { PropertyCountGoal } from '../monthly-portal-goal-identity'

/** What a change is sent against, as of `now`; null once the goal has ended. */
export function changeFactsOf(
  bundle: PropertyCountGoal,
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

/** The month after `YYYY-MM`: four days on from its 28th is always the next one. */
const monthAfter = (month: string): string => addLocalDays(`${month}-28`, 4).slice(0, 7)

/**
 * A stopped goal's way on: the month after the last one it counts, when the
 * set sheet offers it (this month or the next); else null.
 */
export function newGoalFromOf(
  goal: Pick<PortalGoalOfCard, 'status' | 'month' | 'countingMonth'>,
  months: PortalGoalRecommendation['months'],
): string | null {
  if (goal.status !== 'ended') return null
  const last = goal.month?.key ?? goal.countingMonth?.key
  if (last === undefined) return null
  const free = monthAfter(last)
  return free === months.current.key || free === months.next.key ? free : null
}
