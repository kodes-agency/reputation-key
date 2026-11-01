// The running Monthly portal goal on the goal ruler (2026-11-01, ADR 0068): from none
// on the month's first day to the month's number, the month so far, and a stop that
// finally says what it is: where a steady month would stand today. It is not drawn in
// the first quiet days or once the number is passed. Pure.
import type { PortalGoalRunningMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import { rulerModel, type GoalRulerModel } from './goal-ruler-view'
import { dayWords, portalGoalUnit } from './portal-goal-words'

/** Null when the month's figure cannot be read: it is never a zero. */
export function portalGoalRuler(month: PortalGoalRunningMonth): GoalRulerModel | null {
  const { value, target, measure, key } = month
  if (value === null) return null
  const passed = value >= target
  const share = month.elapsedDays / month.totalDays
  const steady = Math.round(target * share)
  const showSteady = !passed && !month.quietDays
  const figure = `${formatNumber(value)} of ${formatNumber(target)} ${portalGoalUnit(measure, target)}`
  return rulerModel({
    label: showSteady
      ? `${figure} so far. A steady month would be at about ${formatNumber(steady)} by today.`
      : `${figure} so far.`,
    from: { value: formatNumber(0), note: dayWords(`${key}-01`) },
    to: { value: formatNumber(target), note: 'your number' },
    at: value / target,
    now: `${formatNumber(value)} so far`,
    stops: showSteady
      ? [{ key: 'steady', at: share, value: formatNumber(steady), note: 'steady pace' }]
      : [],
    reached: passed,
  })
}
