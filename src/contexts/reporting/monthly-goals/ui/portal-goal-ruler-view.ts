// The steady-month marker is not a forecast. Hide it during the first quiet days and
// after the target is passed.

import type { PortalGoalRunningMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import {
  rulerModel,
  type GoalRulerModel,
} from '../../../../components/goals/goal-ruler-view'
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
