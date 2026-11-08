// Gather the domain check-in inputs from the card's goal and its own calendar
// (ADR 0068). Ask only while the running month can change; Keep and any change
// to this month's target answer it. This read writes nothing.

import { monthKeyOf } from '../domain/goal-start'
import { monthlyCheckIn } from '../domain/portal-goal-check-in'
import type { PortalGoalRecommendation } from '../application/dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalCheckIn,
  PortalGoalRunningMonth,
} from '../application/dto/monthly-portal-goal.types'
import type { PropertyCountGoal } from '../application/monthly-portal-goal-identity'
import { checkInOfferOf } from './monthly-portal-goal-offer.server'

export type MonthlyPortalGoalCheckInContext = Readonly<{
  recommendation: PortalGoalRecommendation
  now: Date
  /** The month the goal is counting now, as the card shows it. */
  month: PortalGoalRunningMonth | null
  /** What a change is made against; null once the goal has ended. */
  change: PortalGoalChangeFacts | null
}>

/** `YYYY-MM` of the goal's first month: the earliest it has opened. */
function firstMonthKeyOf(bundle: PropertyCountGoal): string | null {
  const [first] = [...bundle.results].sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime(),
  )
  return first ? monthKeyOf(first.periodStart, first.propertyTimezone) : null
}

/** This month's own number was changed since the month began. */
function changedThisMonth(bundle: PropertyCountGoal, month: string): boolean {
  const running = new Map(
    bundle.results
      .filter(
        ({ status, periodStart, propertyTimezone }) =>
          status === 'open' && monthKeyOf(periodStart, propertyTimezone) === month,
      )
      .map((result) => [result.id, result.periodStart]),
  )
  return (bundle.targetChanges ?? []).some(({ monthlyResultId, createdAt }) => {
    const start = running.get(monthlyResultId)
    return start !== undefined && createdAt >= start
  })
}

/** The check-in the goal's card asks now, or none. */
export function monthlyPortalGoalCheckInOf(
  bundle: PropertyCountGoal,
  context: MonthlyPortalGoalCheckInContext,
): PortalGoalCheckIn | null {
  const { recommendation, now, month } = context
  const running = context.change?.now ?? null
  const firstMonthKey = firstMonthKeyOf(bundle)
  if (month === null || running === null || firstMonthKey === null) return null
  // Use changes the month the change facts name: it must be the one shown.
  if (running.monthKey !== month.key) return null
  const { measure } = month
  const { state } = recommendation.measures[measure]
  const offer = state === 'ready' ? checkInOfferOf(recommendation, measure) : null
  // "No private ratings in the last 4 weeks" says what the basis saw: it needs
  // one, and a measure that came in empty over it.
  const nothingFor = state === 'nothing' ? (recommendation.basis?.weeks ?? null) : null
  const asked = monthlyCheckIn({
    now,
    timezone: running.timezone,
    goal: {
      status: bundle.program.status,
      firstMonthKey,
      currentTarget: running.expectedTarget,
    },
    answeredMonth: bundle.program.checkInAnsweredMonth ?? null,
    changedThisMonth: changedThisMonth(bundle, month.key),
    recommendation: offer?.choices ?? (nothingFor === null ? null : 'nothing'),
  })
  if (asked === null || asked.month !== month.key) return null
  const base = { month: asked.month, measure, target: running.expectedTarget }
  switch (asked.kind) {
    case 'offer':
      return offer === null ? null : { ...base, kind: 'offer', offer }
    case 'same':
      return { ...base, kind: 'same' }
    case 'nothing':
      return nothingFor === null ? null : { ...base, kind: 'nothing', weeks: nothingFor }
  }
}
