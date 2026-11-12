// Use the server's quietDays and belowPace decision. Null means the month has no pace
// verdict.

import type { StatusPresentation } from '#/components/ui/status-badge'
import type { PortalGoalRunningMonth } from '#/contexts/reporting/monthly-goals/contracts'
import { GOAL_PACE_STATUS } from '../../../../components/goals/goal-pace-status'

/**
 * The pill for a running month, the first rule that fits:
 *
 * - no month, or a figure that cannot be read: no pill, there is no pace to say;
 * - the number reached: "On pace", whatever the days say;
 * - the first quiet days of the month: "Getting started";
 * - behind: "Below pace"; on the way: "On pace";
 * - a month the rule does not judge (fewer than 5 expected by today): no pill.
 *
 * A month that is not judged shows nothing rather than a guess, so a pill is
 * always a verdict the rule gave.
 */
export function portalGoalPace(
  month: PortalGoalRunningMonth | null,
): StatusPresentation | null {
  if (month === null || month.value === null) return null
  if (month.value >= month.target) return GOAL_PACE_STATUS.on_pace
  if (month.quietDays) return GOAL_PACE_STATUS.getting_started
  if (month.belowPace === null) return null
  return month.belowPace ? GOAL_PACE_STATUS.below_pace : GOAL_PACE_STATUS.on_pace
}
